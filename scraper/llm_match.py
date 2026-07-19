"""LLM-based figure-listing match validator.

The existing regex / signal-based filters handle most listings cheaply. This helper
is the tie-breaker for borderline cases: when keyword overlap is partial, the
listing title is short, or the price/scale signals are weak.

Design:
  - Calls Ollama on the Mac Mini (configured via LLM_API_URL / LLM_MODEL env vars).
  - Caches every (figure_id, listing_title_hash) → verdict in Redis for 30 days so
    we never burn a second LLM call on the same pair.
  - Returns (accept: bool, confidence: float, reason: str). Caller decides the
    confidence threshold (recommended >= 0.7 for accept, but borderline cases can
    be flagged for human review at lower thresholds).
  - Fails open (returns accept=True, confidence=0.5, reason='llm_unavailable') if
    the LLM is unreachable — we don't block the entire scraper on Mac Mini hiccups.
    Caller can still apply non-LLM checks alongside.
"""

import hashlib
import json
import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

LLM_API_URL = os.environ.get("LLM_API_URL", "http://192.168.50.1:11434/v1").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-oss:20b")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "60"))
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
CACHE_TTL_SECONDS = 30 * 24 * 3600

PROMPT_TEMPLATE = """You are a figure-listing matcher. Decide whether the auction title below refers to the SPECIFIC figure described.

REJECT only if there is a SUBSTANTIVE SKU difference:
- different character entirely (e.g. Saber vs Rin)
- different franchise/series
- different scale (e.g. 1/7 vs 1/4 — but treat ノンスケール/non-scale as wildcard)
- different outfit/version that is its own product (e.g. バニーVer. vs スク水Ver., 限定版 vs 通常版, gray-flesh color variant)

DO NOT reject for any of these (treat as match):
1. Manufacturer aliases — same company in different language/form:
   **GENERAL RULE: Japanese manufacturer names exist in TWO forms — the English/romaji form AND its katakana transliteration. If a name in one form sounds like the name in the other form when read aloud, they refer to the same company.** Examples:
       VERTEX ↔ ヴェルテクス       Phat! ↔ ファット・カンパニー
       Good Smile Company ↔ グッドスマイルカンパニー / 良笑 / GSC
       Max Factory ↔ マックスファクトリー
       Alter ↔ アルター            MegaHouse ↔ メガハウス
       Kotobukiya ↔ 壽屋 / コトブキヤ
       Aniplex ↔ アニプレックス    FREEing ↔ フリーイング
       BANDAI / BANDAI SPIRITS ↔ バンダイ / バンダイスピリッツ
       ORCATOYS ↔ オルカトイズ     quesQ ↔ クエス
       Daibadi Production ↔ ダイバディ
       Mimeyoi ↔ ミメヨイ          Aniplex+ ↔ アニプレックスプラス
   Apply the same rule to any OTHER company not listed above.
   If listing has NO manufacturer at all, DO NOT reject for that — sellers omit it routinely. Only reject if listing names a DIFFERENT manufacturer than the target. If target's manufacturer is "未知" or empty, ignore manufacturer entirely.

2. Character/glyph equivalences — same kanji in different forms is the SAME word:
    晝 ↔ 昼   鐵 ↔ 鉄   國 ↔ 国   學 ↔ 学   體 ↔ 体   實 ↔ 実   龍 ↔ 竜
    亞 ↔ 亜   靈 ↔ 霊   檢 ↔ 検   兒 ↔ 児   雙 ↔ 双   觀 ↔ 観   舊 ↔ 旧
   Full-width/half-width and katakana/hiragana variations are also equivalent.
   This is just Traditional Chinese vs Japanese-simplified-kanji — NOT a different version.

3. Release annotations — these are bundling/distribution markers, NOT different SKUs:
    とらのあな特典付き / 特典付き / 限定版 (when it's a bundled bonus, not a separate SKU)
    ◯◯店特典 / Amazon限定 / アニメイト限定 (distribution channel bonuses)
    劇場版 / 復活のF / 〜the movie〜 (sub-title references to source media, not figure variants)
    新品未開封 / 中古 / 未開封 / 美品 (condition markers)
   These DO NOT change the underlying figure. Match if everything else matches.

4. OCR/typo tolerance — single-character differences that are clearly a typo (e.g. "２P" vs "２O" in 2Pカラー) should match. Look at the overall pattern.

Target figure:
  Name: {fig_name}
  Japanese name: {fig_jp}
  Manufacturer: {fig_mfr}
  Scale: {fig_scale}
  Retail price: {fig_price} {fig_currency}

Auction title: {listing_title}

Reply ONLY with JSON (no other text, no code fences):
{{"match": true_or_false, "confidence": 0.0-1.0, "reason": "<10字內理由>"}}"""


@dataclass(frozen=True)
class MatchResult:
    accept: bool
    confidence: float
    reason: str
    from_cache: bool = False


def _cache_key(figure_id: int, listing_title: str) -> str:
    h = hashlib.sha1(listing_title.encode("utf-8")).hexdigest()[:16]
    # v4 = manufacturer aliases generalised to katakana-transliteration rule.
    # (v5 added a mandatory cross-lingual character rule but it over-rejected
    # legit forward-search matches — 喜多川海夢≠Marin etc. — so it was reverted.
    # The AmiAmi reverse-pull character-confusion problem is handled in the
    # AmiAmi task itself, not here.)
    return f"llm_match:v4:{figure_id}:{h}"


def _build_prompt(figure: dict, listing_title: str) -> str:
    return PROMPT_TEMPLATE.format(
        fig_name=figure.get("name") or "",
        fig_jp=figure.get("original_name") or figure.get("name") or "",
        fig_mfr=figure.get("manufacturer") or "未知",
        fig_scale=figure.get("scale") or "未知",
        fig_price=figure.get("retail_price") or "未知",
        fig_currency=figure.get("retail_currency") or "JPY",
        listing_title=listing_title,
    )


def _parse_llm_response(content: str) -> tuple[bool, float, str]:
    """Extract match verdict from the raw LLM string. Strips code fences and tolerates
    minor formatting glitches."""
    s = content.strip()
    if s.startswith("```"):
        # Strip "```json\n…\n```" wrapping
        s = s.split("```", 2)[1].lstrip("json").strip()
    obj = json.loads(s)
    return bool(obj.get("match")), float(obj.get("confidence", 0.0)), str(obj.get("reason", ""))[:60]


def check_match(
    figure: dict,
    listing_title: str,
    *,
    redis_client=None,
) -> MatchResult:
    """Synchronous LLM check. Returns a verdict + cache hit flag.

    `figure` should expose: name, original_name, manufacturer, scale, retail_price,
    retail_currency. Missing fields fall back to defaults.

    Caching uses Redis. Pass `redis_client` (sync `redis.Redis`) to reuse a pool;
    otherwise a one-shot connection is created."""
    figure_id = figure.get("id")
    if not figure_id or not listing_title:
        return MatchResult(False, 0.0, "missing_input")

    # Cache lookup (Redis) — silently skip on connection problems.
    own_client = False
    if redis_client is None:
        try:
            import redis
            redis_client = redis.Redis.from_url(REDIS_URL, socket_timeout=2)
            own_client = True
        except Exception:
            redis_client = None

    cache_key = _cache_key(figure_id, listing_title)
    if redis_client is not None:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                obj = json.loads(cached)
                return MatchResult(obj["accept"], obj["confidence"], obj["reason"], from_cache=True)
        except Exception:
            pass

    prompt = _build_prompt(figure, listing_title)
    try:
        with httpx.Client(timeout=LLM_TIMEOUT) as client:
            r = client.post(
                f"{LLM_API_URL}/chat/completions",
                json={
                    "model": LLM_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
            accept, confidence, reason = _parse_llm_response(content)
            result = MatchResult(accept, confidence, reason)
    except Exception as e:
        logger.warning("LLM match call failed for figure_id=%s: %s", figure_id, e)
        # Fail open with low confidence so the caller can decide based on other signals.
        return MatchResult(True, 0.5, "llm_unavailable")

    if redis_client is not None:
        try:
            redis_client.setex(
                cache_key,
                CACHE_TTL_SECONDS,
                json.dumps({"accept": result.accept, "confidence": result.confidence, "reason": result.reason}),
            )
        except Exception:
            pass

    if own_client and hasattr(redis_client, "close"):
        try:
            redis_client.close()
        except Exception:
            pass

    return result
