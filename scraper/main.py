"""Figurein scraper — Hpoi-first approach.

Phase 0: Import figure catalog from Hpoi.net (structured data, no LLM needed).
Phase 1: (Future) Fetch secondhand prices from auction sites.
"""

import asyncio
import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median

from celery import Celery
from celery.schedules import crontab
from sqlalchemy import func, or_, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import Character, ErrorReport, Figure, Franchise, Listing, PriceSnapshot
from db.session import SessionLocal
from listing_validator import validate_listing
from opencc import OpenCC
from currency import to_display as _to_display


def _to_canonical_twd(price: float, currency: str) -> float:
    """Convert any (price, currency) pair to the canonical TWD value used by the
    `listings.price_canonical` column (legacy name, TWD contents). Uses fallback rates
    so we don't fetch live rates inside batch scrapes."""
    return _to_display(price, currency, "TWD", {}) or 0.0

_s2t = OpenCC("s2t")  # Simplified -> Traditional Chinese

# Cheap figure types to exclude
CHEAP_PATTERNS = re.compile(
    r"(粘土人|黏土人|nendoroid|figma|景品|一番赏|一番獎|扭蛋|盲盒|trading|食玩|迷你)",
    re.IGNORECASE,
)

# Price-scrape refresh cadence: a figure is re-scraped on a source once its last
# scan (figures.{yahoo,mercari}_scanned_at) is older than this many days. Popular
# figures cycle back for fresh prices; recently-scanned ones are skipped so each
# run makes forward progress through the view_count-ranked queue.
YAHOO_STALE_DAYS = 21
MERCARI_STALE_DAYS = 21



# Keywords indicating different figure types that should not be mixed
NENDOROID_KEYWORDS = re.compile(
    r"(ねんどろいど|黏土人|粘土人|nendoroid)",
    re.IGNORECASE,
)
FIGMA_KEYWORDS = re.compile(
    r"(figma|フィグマ)",
    re.IGNORECASE,
)
PRIZE_KEYWORDS = re.compile(
    r"(景品|プライズ|一番くじ|一番賞)",
    re.IGNORECASE,
)

# Keywords for non-figure items that should be filtered out of listings
_NON_FIGURE_KEYWORDS = re.compile(
    r"(ぬいぐるみ|アクリルスタンド|アクリルキーホルダー|キーホルダー|ストラップ"
    r"|缶バッジ|タペストリー|抱き枕|ラバスト|ラバーストラップ|クリアファイル"
    r"|ポスター|Tシャツ|マグカップ|トレカ|カード|シール|ステッカー"
    r"|ちびきゅんキャラ|ワールドコレクタブル|WCF)",
    re.IGNORECASE,
)

_MIXED_LOT_KEYWORDS = re.compile(
    r"(まとめ|セット売り|他多数|おまけ|ジャンク|大量)",
    re.IGNORECASE,
)


def is_valid_figure_listing(title: str) -> bool:
    """Return False if the listing title indicates a non-figure item or mixed lot."""
    if _NON_FIGURE_KEYWORDS.search(title):
        return False
    if _MIXED_LOT_KEYWORDS.search(title):
        return False
    return True

def listing_matches_figure_type(title: str, figure_type: str | None, scale: str | None) -> bool:
    """Check if a listing title is compatible with the figure type/scale.
    
    Returns False if the listing is clearly a different product type
    (e.g., Nendoroid listing for a 1/8 scale figure).
    """
    title_lower = title.lower()
    
    # If the figure is a scale figure (has scale like 1/7, 1/8 etc)
    is_scale_figure = scale and re.match(r"1/\d+", scale)
    is_nendoroid = figure_type and ("黏土人" in figure_type or "nendoroid" in figure_type.lower())
    is_figma = figure_type and ("figma" in figure_type.lower())
    
    if is_scale_figure and not is_nendoroid:
        # Scale figure should NOT match Nendoroid listings
        if NENDOROID_KEYWORDS.search(title):
            return False
        if FIGMA_KEYWORDS.search(title):
            return False
        if PRIZE_KEYWORDS.search(title):
            return False
    
    if is_nendoroid:
        # Nendoroid should not match scale figures without nendoroid keyword
        # Only accept if title contains nendoroid keyword
        if not NENDOROID_KEYWORDS.search(title):
            # Could be scale figure listing, skip
            pass  # Allow for now, fuzzy matching is hard here
    
    return True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

app = Celery("figureout_scraper", broker=REDIS_URL, backend=REDIS_URL)
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
)


# ---------------------------------------------------------------------------
# Manufacturer & franchise normalization
# ---------------------------------------------------------------------------

MANUFACTURER_ALIASES = {
    "良笑": "Good Smile Company",
    "良笑社": "Good Smile Company",
    "gsc": "Good Smile Company",
    "good smile company": "Good Smile Company",
    "グッドスマイルカンパニー": "Good Smile Company",
    "max factory": "Max Factory",
    "マックスファクトリー": "Max Factory",
    "mf": "Max Factory",
    "alter": "Alter",
    "アルター": "Alter",
    "寿屋": "Kotobukiya",
    "kotobukiya": "Kotobukiya",
    "コトブキヤ": "Kotobukiya",
    "freeing": "FREEing",
    "フリーイング": "FREEing",
    "myethos": "Myethos",
    "bandai spirits": "Bandai Spirits",
    "万代": "Bandai Spirits",
    "megahouse": "MegaHouse",
    "メガハウス": "MegaHouse",
    "native": "Native",
    "ネイティブ": "Native",
    "furyu": "FuRyu",
    "フリュー": "FuRyu",
    "kadokawa": "KADOKAWA",
    "aniplex": "Aniplex",
    "wonderful works": "Wonderful Works",
    "ワンダフルワークス": "Wonderful Works",
    "estream": "eStream",
    "apex": "Apex Innovation",
    "phat company": "Phat Company",
    "ファット・カンパニー": "Phat Company",
    "stronger": "Stronger",
    "broccoli": "Broccoli",
    "ques q": "Ques Q",
    "flare": "Flare",
    "wing": "Wing",
    "orchid seed": "Orchid Seed",
    "alphamax": "Alphamax",
    "aquamarine": "Aquamarine",
    "vertex": "Vertex",
    "union creative": "Union Creative",
    "hobby max": "Hobby Max",
    "spiritale": "Spiritale",
    "bellfine": "BellFine",
    "wave": "Wave",
    "prime 1 studio": "Prime 1 Studio",
    "emontoys": "Emontoys",
}

FRANCHISE_ALIASES = {
    # Map known variations to canonical Traditional Chinese names
    # Hpoi uses simplified Chinese; after s2t conversion these should match
    "fate/grand order": "Fate/Grand Order",
    "fate/stay night": "Fate/Stay Night",
    "fate/zero": "Fate/Zero",
    "fate series": "Fate/Grand Order",
    "Fate Series": "Fate/Grand Order",
    "vocaloid": "VOCALOID",
    "Vocaloid": "VOCALOID",
    "re:zero": "Re:從零開始的異世界生活",
    "Re:Zero": "Re:從零開始的異世界生活",
    "azur lane": "Azur Lane",
    "Azur Lane": "碧藍航線",
    "arknights": "明日方舟",
    "Arknights": "明日方舟",
    "genshin impact": "原神",
    "Genshin Impact": "原神",
    "chainsaw man": "鏈鋸人",
    "Chainsaw Man": "鏈鋸人",
    "spy x family": "間諜過家家",
    "Spy x Family": "間諜過家家",
    "hololive": "Hololive",
    "one piece": "海賊王",
    "One Piece": "海賊王",
    "demon slayer": "鬼滅之刃",
    "Demon Slayer": "鬼滅之刃",
    "my hero academia": "我的英雄學院",
    "My Hero Academia": "我的英雄學院",
    "evangelion": "新世紀福音戰士",
    "Evangelion": "新世紀福音戰士",
    "sword art online": "刀劍神域",
    "Sword Art Online": "刀劍神域",
    "konosuba": "為美好的世界獻上祝福",
    "KonoSuba": "為美好的世界獻上祝福",
    "mushoku tensei": "無職轉生",
    "Mushoku Tensei": "無職轉生",
    "date a live": "約會大作戰",
    "Date A Live": "約會大作戰",
    "girls' frontline": "少女前線",
    "Girls' Frontline": "少女前線",
    "overlord": "OVERLORD",
    "Overlord": "OVERLORD",
    "blue archive": "蔚藍檔案",
    "Blue Archive": "蔚藍檔案",
    "nier": "尼爾",
    "NieR": "尼爾",
    "saekano": "路人女主的養成方法",
    "Saekano": "路人女主的養成方法",
    "the quintessential quintuplets": "五等分的新娘",
    "The Quintessential Quintuplets": "五等分的新娘",
    "that time i got reincarnated as a slime": "關於我轉生變成史萊姆這檔事",
    "puella magi madoka magica": "魔法少女小圓",
    "Puella Magi Madoka Magica": "魔法少女小圓",
    "touhou project": "東方Project",
    "Touhou Project": "東方Project",
    "the idolm@ster": "偶像大師",
    "THE IDOLM@STER": "偶像大師",
    "love live!": "Love Live!",
    "Love Live!": "Love Live!",
    "bocchi the rock!": "孤獨搖滾！",
    "Bocchi the Rock!": "孤獨搖滾！",
    "uma musume": "賽馬娘",
    "Uma Musume": "賽馬娘",
    "kantai collection": "艦隊Collection",
    "Kantai Collection": "艦隊Collection",
    "princess connect": "公主連結",
    "Princess Connect": "公主連結",
    "honkai impact 3rd": "崩壞3",
    "Honkai Impact 3rd": "崩壞3",
    "honkai: star rail": "崩壞：星穹鐵道",
    "Honkai: Star Rail": "崩壞：星穹鐵道",
    "steins;gate": "命運石之門",
    "Steins;Gate": "命運石之門",
    "no game no life": "遊戲人生",
    "No Game No Life": "遊戲人生",
    "No Game No Life: Zero": "遊戲人生：零",
    "my teen romantic comedy snafu": "我的青春戀愛物語果然有問題",
    "My Teen Romantic Comedy SNAFU": "我的青春戀愛物語果然有問題",
}


def normalize_manufacturer(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    return MANUFACTURER_ALIASES.get(key, raw.strip())


def normalize_franchise(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in FRANCHISE_ALIASES:
        return FRANCHISE_ALIASES[key]
    for alias, canonical in FRANCHISE_ALIASES.items():
        if alias in key or key in alias:
            return canonical
    return raw.strip()


def normalize_scale(raw: str | None) -> str | None:
    if not raw:
        return None
    match = re.search(r"1\s*/\s*(\d+)", raw)
    return f"1/{match.group(1)}" if match else None


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_or_create_franchise(session, name: str) -> int:
    canonical = normalize_franchise(name) or name
    existing = session.query(Franchise).filter(
        func.lower(Franchise.name) == canonical.lower()
    ).first()
    if existing:
        return existing.id
    f = Franchise(name=canonical)
    session.add(f)
    session.flush()
    return f.id


def _get_or_create_character(session, name: str, franchise_id: int) -> int:
    existing = session.query(Character).filter(
        func.lower(Character.name) == name.lower(),
        Character.franchise_id == franchise_id,
    ).first()
    if existing:
        return existing.id
    c = Character(name=name, franchise_id=franchise_id)
    session.add(c)
    session.flush()
    return c.id


# ---------------------------------------------------------------------------
# Phase 0: Hpoi catalog import
# ---------------------------------------------------------------------------
@app.task(name="import_hpoi_catalog", bind=True, max_retries=2, default_retry_delay=300)
def import_hpoi_catalog(self, start_page: int = 1, max_pages: int = 100, order: str = "rating") -> dict:
    """Import figure catalog from Hpoi.net — incremental per-page DB writes."""
    import random as _random
    from scrapers.hpoi import HpoiScraper

    logger.info("Starting Hpoi catalog import (pages %d-%d, order=%s)", start_page, start_page + max_pages - 1, order)

    total_created = 0
    total_skipped = 0
    total_errors = 0
    total_fetched = 0
    seen_ids: set[int] = set()

    def _import_batch(figures_data: list[dict]) -> tuple[int, int, int]:
        session = SessionLocal()
        created = skipped = errors = 0
        try:
            for fig_data in figures_data:
                try:
                    name = fig_data.get("name", "")
                    if not name:
                        skipped += 1
                        continue

                    # Skip cheap figure types
                    if CHEAP_PATTERNS.search(name):
                        skipped += 1
                        continue

                    # Convert Simplified to Traditional Chinese
                    name = _s2t.convert(name)

                    character_name = _s2t.convert(fig_data.get("character", "")) if fig_data.get("character") else ""
                    franchise_name = _s2t.convert(fig_data.get("franchise", "")) if fig_data.get("franchise") else ""
                    manufacturer = normalize_manufacturer(fig_data.get("manufacturer"))
                    scale = normalize_scale(fig_data.get("scale"))
                    hpoi_id = str(fig_data.get("hpoi_id", ""))

                    if not character_name and not franchise_name:
                        skipped += 1
                        continue

                    if not franchise_name:
                        franchise_name = "Unknown"
                    if not character_name:
                        character_name = name.split(" ")[0] if " " in fig.name else fig.name

                    franchise_name = normalize_franchise(franchise_name) or franchise_name
                    franchise_id = _get_or_create_franchise(session, franchise_name)
                    character_id = _get_or_create_character(session, character_name, franchise_id)

                    # Dedup by hpoi_id (stored in source_id)
                    if hpoi_id:
                        existing = session.query(Figure).filter(Figure.source_id == hpoi_id).first()
                        if existing:
                            skipped += 1
                            continue

                    # Dedup by name + character
                    existing = session.query(Figure).filter(
                        Figure.character_id == character_id,
                        func.lower(Figure.name) == name.lower(),
                    ).first()
                    if existing:
                        skipped += 1
                        continue

                    figure = Figure(
                        name=name,
                        character_id=character_id,
                        franchise_id=franchise_id,  # mirror character's franchise so fig.franchise_id is populated on insert
                        manufacturer=manufacturer,
                        scale=scale,
                        source_id=hpoi_id if hpoi_id else None,
                        image_url=fig_data.get("image_url"),
                    )
                    session.add(figure)
                    session.flush()
                    created += 1
                except Exception:
                    session.rollback()
                    errors += 1
                    if errors <= 5:
                        logger.exception("Error importing: %s", fig_data.get("name", "?"))
                    continue

            session.commit()
        except Exception:
            session.rollback()
            logger.exception("Batch commit failed")
        finally:
            session.close()
        return created, skipped, errors

    async def _run():
        nonlocal total_created, total_skipped, total_errors, total_fetched, seen_ids
        scraper = HpoiScraper()
        consecutive_empty = 0
        try:
            for page in range(start_page, start_page + max_pages):
                items = await scraper.get_list_page(page=page, order=order)
                if not items:
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        logger.info("3 consecutive empty pages, stopping")
                        break
                    continue
                consecutive_empty = 0

                new_items = [it for it in items if it["hpoi_id"] not in seen_ids]
                for it in new_items:
                    seen_ids.add(it["hpoi_id"])
                total_fetched += len(new_items)

                # Write this page to DB immediately
                c, s, e = _import_batch(new_items)
                total_created += c
                total_skipped += s
                total_errors += e

                logger.info(
                    "Hpoi page %d/%d: +%d created, %d skipped. Total: %d created / %d fetched",
                    page, start_page + max_pages - 1, c, s, total_created, total_fetched,
                )
                await asyncio.sleep(_random.uniform(1.0, 2.5))
        finally:
            await scraper.close()

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.exception("Hpoi catalog scrape failed")
        raise self.retry(exc=exc)

    logger.info(
        "Hpoi import complete: %d fetched, %d created, %d skipped, %d errors",
        total_fetched, total_created, total_skipped, total_errors,
    )
    return {"fetched": total_fetched, "created": total_created, "skipped": total_skipped, "errors": total_errors}



# ---------------------------------------------------------------------------
# Phase 0.5: Enrich figures with detail page data
# ---------------------------------------------------------------------------

@app.task(name="enrich_figures", bind=True, max_retries=1, default_retry_delay=300)
def enrich_figures(self, batch_size: int = 100, min_price_jpy: int = 0) -> dict:
    """Fetch Hpoi detail pages to enrich figures with images, prices, proper character/franchise."""
    import asyncio as _asyncio
    import random as _random
    from scrapers.hpoi_detail import HpoiDetailScraper

    session = SessionLocal()
    updated = 0
    deleted = 0
    errors = 0
    processed = 0

    try:
        figures = session.query(Figure).filter(
            Figure.image_url.is_(None),
            Figure.source_id.isnot(None),
        ).limit(batch_size).all()

        if not figures:
            logger.info("No figures to enrich")
            return {"processed": 0, "updated": 0, "deleted": 0}

        hpoi_ids = [(f.id, int(f.source_id)) for f in figures]
        logger.info("Enriching %d figures from Hpoi detail pages", len(hpoi_ids))

        async def _fetch_all():
            scraper = HpoiDetailScraper()
            results = {}
            sem = _asyncio.Semaphore(8)  # 3 concurrent requests

            async def _fetch_one(fig_id, hpoi_id):
                async with sem:
                    data = await scraper.fetch_detail(hpoi_id)
                    if data:
                        results[fig_id] = data
                    await _asyncio.sleep(_random.uniform(0.3, 0.6))

            try:
                tasks = [_fetch_one(fid, hid) for fid, hid in hpoi_ids]
                await _asyncio.gather(*tasks)
            finally:
                await scraper.close()
            return results

        detail_map = _asyncio.run(_fetch_all())
        processed = len(hpoi_ids)

        for fig in figures:
            detail = detail_map.get(fig.id)
            if not detail:
                errors += 1
                continue

            price_jpy = detail.get("price_jpy", 0)

            if min_price_jpy > 0 and (price_jpy == 0 or price_jpy < min_price_jpy):
                session.delete(fig)
                deleted += 1
                continue

            if detail.get("image_url"):
                fig.image_url = detail["image_url"]

            if detail.get("manufacturer"):
                fig.manufacturer = normalize_manufacturer(detail["manufacturer"])

            if detail.get("scale"):
                fig.scale = detail["scale"]

            # Always update franchise/character from detail page
            detail_franchise = detail.get("franchise", "")
            detail_character = detail.get("character", "")
            if detail_franchise:
                new_franchise = _s2t.convert(detail_franchise)
                # Don't normalize to English - keep Chinese names
                franchise_id = _get_or_create_franchise(session, new_franchise)
                if detail_character:
                    new_character = _s2t.convert(detail_character)
                else:
                    new_character = fig.name.split(" ")[0] if " " in fig.name else fig.name
                character_id = _get_or_create_character(session, new_character, franchise_id)
                fig.character_id = character_id
                # Keep denormalised figure.franchise_id in sync with the character's
                # new franchise — otherwise enrich silently leaves them drifted.
                fig.franchise_id = franchise_id

            if price_jpy > 0:
                fig.retail_price = price_jpy

            if detail.get("release_date"):
                try:
                    fig.release_year = int(detail["release_date"].split("/")[0])
                except (ValueError, IndexError):
                    pass

            if detail.get("japanese_name"):
                fig.original_name = detail["japanese_name"]

            # New detail fields
            if detail.get("sculptor"):
                fig.sculptor = _s2t.convert(detail["sculptor"])
            if detail.get("painter"):
                fig.painter = _s2t.convert(detail["painter"])
            if detail.get("dimensions"):
                fig.dimensions = detail["dimensions"]
            if detail.get("material"):
                fig.material = detail.get("material")
            if detail.get("gender"):
                fig.gender = detail["gender"]
            if detail.get("figure_type"):
                fig.figure_type = detail["figure_type"]
            # Auto-classify GK: resin material = GK
            if fig.material and "樹脂" in fig.material:
                fig.figure_type = "GK"
            if detail.get("age_rating"):
                fig.age_rating = detail["age_rating"]
            if detail.get("release_date"):
                fig.release_date = detail["release_date"]
            if detail.get("reissue_dates"):
                fig.reissue_dates = detail["reissue_dates"]

            updated += 1

        session.commit()
        logger.info(
            "Enrichment done: %d processed, %d updated, %d deleted (below %d JPY), %d errors",
            processed, updated, deleted, min_price_jpy, errors,
        )
    except Exception:
        session.rollback()
        logger.exception("Enrichment failed")
    finally:
        session.close()

    return {"processed": processed, "updated": updated, "deleted": deleted, "errors": errors}


# ---------------------------------------------------------------------------
# Phase 1: Scrape secondhand prices from Suruga-ya
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Phase 1: Scrape completed sales from Mercari Japan (real P2P prices)
# ---------------------------------------------------------------------------

@app.task(name="scrape_mercari_prices", bind=True, max_retries=1, default_retry_delay=300)
def scrape_mercari_prices(self, batch_size: int = 30) -> dict:
    """Search Mercari Japan for completed sales using Japanese figure names."""
    import asyncio as _asyncio
    import random as _random
    from scrapers.mercari import MercariScraper

    session = SessionLocal()
    matched = 0
    listings_created = 0
    errors = 0
    processed = 0

    try:
        # Refresh-oriented selection (same rationale as the Yahoo task): most-
        # viewed figures not scanned on Mercari within the staleness window,
        # rather than "uncovered-first" which stuck on the niche tail and never
        # refreshed popular figures. The per-figure `mercari_scanned_at` stamp
        # (set in the loop) stops re-grinding zero-match names every run.
        from sqlalchemy import or_
        stale_cutoff = datetime.now(timezone.utc) - timedelta(days=MERCARI_STALE_DAYS)
        figures = (
            session.query(Figure)
            .filter(
                Figure.image_url.isnot(None),
                Figure.original_name.isnot(None),
                Figure.retail_price.isnot(None),
                or_(Figure.mercari_scanned_at.is_(None),
                    Figure.mercari_scanned_at < stale_cutoff),
            )
            .order_by(
                Figure.view_count.desc().nullslast(),
                Figure.id,
            )
            .limit(batch_size)
            .all()
        )

        if not figures:
            logger.info("No figures to price-check on Mercari")
            return {"processed": 0, "matched": 0, "listings": 0}

        logger.info("Mercari price-check: %d figures", len(figures))

        async def _fetch():
            nonlocal matched, listings_created, errors, processed
            # Share one Chromium across the whole batch — launching per query
            # would cost ~2s × batch_size of startup time.
            async with MercariScraper() as scraper:
                for fig in figures:
                    processed += 1
                    # Stamp scan time up front (match or not) so we don't re-grind
                    # the same zero-match names each run — mirrors the Yahoo task.
                    fig.mercari_scanned_at = datetime.now(timezone.utc)
                    # Trim long names — Mercari's keyword-too-specific path returns 0.
                    query = (fig.original_name or "")[:50]
                    if not query.strip():
                        continue

                    try:
                        results = await scraper.search_sold(query, limit=20)
                        if not results:
                            await _asyncio.sleep(_random.uniform(2.0, 4.0))
                            continue

                        matched += 1
                        fig_dict = {
                            "id": fig.id, "name": fig.name,
                            "original_name": fig.original_name,
                            "manufacturer": fig.manufacturer, "scale": fig.scale,
                            "retail_price": fig.retail_price,
                            "retail_currency": fig.retail_currency or "JPY",
                        }
                        # Look at slightly more candidates than Yahoo since the LLM
                        # gate filters Mercari's noisier "bundle/lot" listings hard.
                        for r in results[:5]:
                            if not r.get("source_id"):
                                continue
                            existing = session.query(Listing).filter(
                                Listing.source == "mercari",
                                Listing.source_id == r["source_id"],
                            ).first()
                            if existing:
                                continue

                            if fig.retail_price and r["price_jpy"] > 0:
                                ratio = r["price_jpy"] / fig.retail_price
                                if ratio > 5.0 or ratio < 0.05:
                                    continue

                            if not is_valid_figure_listing(r["title"]):
                                is_valid, reason = validate_listing(r["title"])
                                if not is_valid:
                                    # Dedup: the same blocked item resurfaces every
                                    # run (it stays listed on Mercari), so only file
                                    # one report per URL — otherwise the review queue
                                    # fills with duplicates of the same body-pillow/etc.
                                    _url = r.get("url") or ""
                                    _dupe = _url and session.query(ErrorReport).filter(
                                        ErrorReport.report_type == "suspicious_listing",
                                        ErrorReport.description.like(f"%{_url}%"),
                                    ).first()
                                    if not _dupe:
                                        session.add(ErrorReport(
                                            figure_id=fig.id,
                                            report_type="suspicious_listing",
                                            description=(
                                                f"[Mercari] 疑似非公仔商品: {reason}"
                                                f"\nTitle: {r['title']}\nURL: {_url or 'N/A'}"
                                            ),
                                            status="pending",
                                        ))
                                        logger.info("Flagged suspicious Mercari listing: %s", r["title"][:50])
                                continue
                            if not listing_matches_figure_type(r["title"], fig.figure_type, fig.scale):
                                continue

                            # LLM gate — catches まとめ売 / lot bundles and same-character
                            # different-version cases that regex can't reliably reject.
                            from llm_match import check_match
                            verdict = check_match(fig_dict, r["title"])
                            if (not verdict.accept or verdict.confidence < 0.7) \
                                    and verdict.reason != "llm_unavailable":
                                logger.debug(
                                    "LLM rejected mercari fig=%d title=%r conf=%.2f reason=%s",
                                    fig.id, r["title"][:60], verdict.confidence, verdict.reason,
                                )
                                continue

                            # Mercari only shows relative times — fetch the item
                            # detail page to resolve sold_at. One extra page load
                            # per ACCEPTED listing only (LLM already filtered).
                            try:
                                sold_at = await scraper.fetch_sold_at(r["source_id"])
                            except Exception:
                                sold_at = None

                            try:
                                session.add(Listing(
                                    figure_id=fig.id, source="mercari",
                                    source_id=r["source_id"], title=r["title"],
                                    price=r["price_jpy"], currency="JPY",
                                    price_canonical=round(_to_canonical_twd(r["price_jpy"], "JPY"), 2),
                                    condition=r.get("condition", "used"),
                                    is_sold=True, url=r["url"],
                                    image_url=r.get("image_url"),
                                    sold_at=sold_at,
                                ))
                                session.flush()
                                listings_created += 1
                            except Exception:
                                session.rollback()
                    except Exception:
                        errors += 1
                        if errors <= 5:
                            logger.exception("Mercari search failed: %s", (fig.original_name or '?')[:30])

                    await _asyncio.sleep(_random.uniform(2.0, 4.0))

        _asyncio.run(_fetch())
        session.commit()
        logger.info(
            "Mercari done: %d processed, %d matched, %d listings, %d errors",
            processed, matched, listings_created, errors,
        )
    except Exception:
        session.rollback()
        logger.exception("Mercari scrape failed")
    finally:
        session.close()

    return {"processed": processed, "matched": matched, "listings": listings_created, "errors": errors}



# ---------------------------------------------------------------------------
# Phase 1c: Scrape preowned listings from AmiAmi (Japanese retailer used market)
# ---------------------------------------------------------------------------

def _amiami_canon_mfr(s: str | None) -> str | None:
    """Canonicalise manufacturer strings from EITHER AmiAmi (English) OR our
    DB (EN/JP/Chinese mix) to a single key so we can index by manufacturer.

    AmiAmi search returns 0 results for Japanese keywords, so the per-figure
    search approach fails. We instead pull AmiAmi's entire preowned inventory
    and reverse-match each item to a Figure using manufacturer + scale.
    """
    import re as _re
    if not s:
        return None
    s_low = s.lower().strip()
    rules = [
        (r"good\s*smile|gsc|良笑|グッドスマイル", "gsc"),
        (r"phat|ファット", "phat"),
        (r"max\s*factory|マックスファクトリー", "maxfactory"),
        (r"^alter\b|^alter$|アルター", "alter"),
        (r"megahouse|メガハウス|メガ\b", "megahouse"),
        (r"kotobukiya|コトブキヤ|壽屋|寿屋", "kotobukiya"),
        (r"aniplex|アニプレックス", "aniplex"),
        (r"freeing|フリーイング", "freeing"),
        (r"bandai|バンダイ", "bandai"),
        (r"orcatoys|オルカトイズ", "orcatoys"),
        (r"quesq|クエス", "quesq"),
        (r"vertex|ヴェルテクス", "vertex"),
        (r"daibadi|ダイバディ", "daibadi"),
        (r"mimeyoi|ミメヨイ", "mimeyoi"),
        (r"furyu|f[:_]nex|フリュー", "furyu"),
        (r"wave|ウェーブ", "wave"),
        (r"spiritale", "spiritale"),
        (r"elcoco", "elcoco"),
        (r"claynel", "claynel"),
        (r"union\s*creative|ユニオンクリエイティブ", "unioncreative"),
        (r"hobby\s*stock", "hobbystock"),
        (r"plum", "plum"),
    ]
    for pat, canon in rules:
        if _re.search(pat, s_low):
            return canon
    # fallback to alphanumeric squash so two identical brand strings still
    # match each other even if not in the rules list above.
    return _re.sub(r"[^a-z0-9]", "", s_low) or None


@app.task(name="scrape_amiami_preowned", bind=True, max_retries=1, default_retry_delay=600)
def scrape_amiami_preowned(self, _unused_batch_size: int = None) -> dict:
    """Reverse-pull AmiAmi preowned inventory and match each item to a Figure
    in our DB. (The per-figure search approach in the prior version returned
    zero matches because AmiAmi's `lang=eng` keyword index does not respond
    to Japanese search terms — see commit/note in _amiami_canon_mfr.)

    Flow:
      1. Paginate AmiAmi `s_st_condition_flg=1` (~500 items, 8-12s between pages)
      2. Build an in-memory index of our figures grouped by canonical manufacturer
      3. For each AmiAmi item: dedup → candidate figures (same canon mfr + same/no scale)
         → LLM-gate top 8 candidates → insert best match if conf ≥ 0.7

    `batch_size` is unused — we always pull the full preowned set per run.
    """
    import asyncio as _asyncio
    from scrapers.amiami import AmiAmiScraper
    from llm_match import check_match

    session = SessionLocal()
    items_seen = 0
    items_existing = 0
    items_no_candidate = 0
    items_no_match = 0
    listings_created = 0
    errors = 0

    try:
        # Pre-build canon → [figures] index. Only consider figures with both
        # original_name and a manufacturer (we use both downstream).
        all_figs = (
            session.query(Figure)
            .filter(Figure.manufacturer.isnot(None),
                    Figure.original_name.isnot(None))
            .all()
        )
        mfr_index: dict[str, list] = {}
        for f in all_figs:
            canon = _amiami_canon_mfr(f.manufacturer)
            if canon:
                mfr_index.setdefault(canon, []).append(f)
        logger.info(
            "AmiAmi reverse-pull: indexed %d figures across %d manufacturer canons",
            len(all_figs), len(mfr_index),
        )

        async def _do_scrape():
            nonlocal items_seen, items_existing, items_no_candidate
            nonlocal items_no_match, listings_created, errors

            # Step 1: pull all preowned items first; the candidate-matching loop
            # is CPU/DB-bound and should not hold open an HTTP client across
            # 500+ LLM calls.
            items: list[dict] = []
            async with AmiAmiScraper() as scraper:
                try:
                    async for item in scraper.iter_preowned_all_pages():
                        items.append(item)
                except Exception:
                    logger.exception("AmiAmi pagination crashed mid-stream")
            logger.info("AmiAmi pulled %d preowned items", len(items))

            # Step 2: match each item to a Figure
            for item in items:
                items_seen += 1
                try:
                    existing = session.query(Listing).filter(
                        Listing.source == "amiami",
                        Listing.source_id == item["source_id"],
                    ).first()
                    if existing:
                        items_existing += 1
                        continue

                    canon = _amiami_canon_mfr(item.get("maker_raw"))
                    if not canon:
                        items_no_candidate += 1
                        continue

                    pool = mfr_index.get(canon, [])
                    if not pool:
                        items_no_candidate += 1
                        continue

                    # Scale filter: if AmiAmi item has scale, require figure
                    # scale to match (or be unknown). If item is non-scale,
                    # don't constrain.
                    scale = item.get("scale_str")
                    if scale:
                        candidates = [f for f in pool if not f.scale or f.scale == scale]
                    else:
                        candidates = list(pool)
                    if not candidates:
                        items_no_candidate += 1
                        continue

                    # Cap top 8 by view_count to bound LLM calls per item
                    candidates.sort(key=lambda f: -(f.view_count or 0))
                    candidates = candidates[:8]

                    best = None  # (figure, verdict)
                    for fig in candidates:
                        fig_dict = {
                            "id": fig.id, "name": fig.name,
                            "original_name": fig.original_name,
                            "manufacturer": fig.manufacturer, "scale": fig.scale,
                            "retail_price": fig.retail_price,
                            "retail_currency": fig.retail_currency or "JPY",
                        }
                        verdict = check_match(fig_dict, item["title"])
                        # Reverse-pull uses a higher bar than forward-search
                        # (0.85 vs 0.70): when the true figure is absent from
                        # our DB the LLM can still score a same-series wrong
                        # candidate in the 0.7-0.85 band. Genuine reverse-pull
                        # matches sit at 0.95+, so 0.85 costs us nothing real.
                        if (verdict.accept
                                and verdict.confidence >= 0.85
                                and (best is None
                                     or verdict.confidence > best[1].confidence)):
                            best = (fig, verdict)
                            # Confidence 0.99 — short-circuit: unlikely a
                            # different candidate would beat this and we save LLM calls
                            if verdict.confidence >= 0.99:
                                break

                    if not best:
                        items_no_match += 1
                        continue

                    fig, verdict = best
                    try:
                        session.add(Listing(
                            figure_id=fig.id, source="amiami",
                            source_id=item["source_id"], title=item["title"],
                            price=item["price_jpy"], currency="JPY",
                            price_canonical=round(_to_canonical_twd(item["price_jpy"], "JPY"), 2),
                            condition="used", is_sold=False,
                            url=item["url"], image_url=item.get("image_url"),
                        ))
                        session.flush()
                        listings_created += 1
                        if listings_created <= 5 or listings_created % 25 == 0:
                            logger.info(
                                "AmiAmi MATCH #%d: F%d ¥%d conf=%.2f | %s",
                                listings_created, fig.id, item["price_jpy"],
                                verdict.confidence, item["title"][:60],
                            )
                    except Exception:
                        session.rollback()
                        errors += 1
                except Exception:
                    errors += 1
                    if errors <= 5:
                        logger.exception("AmiAmi match failed for gcode=%s",
                                         item.get("source_id"))

        _asyncio.run(_do_scrape())
        session.commit()
        logger.info(
            "AmiAmi reverse-pull done: seen=%d existing=%d no_candidate=%d "
            "no_match=%d new_listings=%d errors=%d",
            items_seen, items_existing, items_no_candidate,
            items_no_match, listings_created, errors,
        )
    except Exception:
        session.rollback()
        logger.exception("AmiAmi reverse-pull crashed")
    finally:
        session.close()

    return {
        "items_seen": items_seen, "existing": items_existing,
        "no_candidate": items_no_candidate, "no_match": items_no_match,
        "listings": listings_created, "errors": errors,
    }



# ---------------------------------------------------------------------------
# Phase 1b: Scrape completed auctions from Yahoo Auctions Japan
# ---------------------------------------------------------------------------

@app.task(name="scrape_yahoo_prices", bind=True, max_retries=1, default_retry_delay=300)
def scrape_yahoo_prices(self, batch_size: int = 30) -> dict:
    """Search Yahoo Auctions Japan for completed auction prices."""
    import asyncio as _asyncio
    import random as _random
    from scrapers.yahoo_auction import YahooAuctionScraper

    session = SessionLocal()
    matched = 0
    listings_created = 0
    errors = 0
    processed = 0

    try:
        # Refresh-oriented selection. The old "uncovered-first" ordering
        # (has_yahoo.asc()) ground the niche tail forever — 300 processed / 1
        # listing per day — and NEVER re-scraped the ~1,800 popular figures that
        # already had a Yahoo listing, so their prices silently went stale.
        # New strategy: pick figures NOT scanned on Yahoo within the staleness
        # window, most-viewed first. The per-figure `yahoo_scanned_at` stamp set
        # in the loop (below) marks every processed figure — match or not — so
        # we stop re-grinding the same zero-match niche names each run, and
        # popular figures cycle back for a fresh scrape every ~YAHOO_STALE_DAYS.
        from sqlalchemy import or_
        stale_cutoff = datetime.now(timezone.utc) - timedelta(days=YAHOO_STALE_DAYS)
        figures = session.query(Figure).filter(
            Figure.image_url.isnot(None),
            Figure.original_name.isnot(None),
            Figure.retail_price.isnot(None),
            or_(Figure.yahoo_scanned_at.is_(None),
                Figure.yahoo_scanned_at < stale_cutoff),
        ).order_by(
            Figure.view_count.desc().nullslast(),
            Figure.id,
        ).limit(batch_size).all()

        if not figures:
            logger.info("No figures to price-check on Yahoo Auctions")
            return {"processed": 0, "matched": 0, "listings": 0}

        logger.info("Yahoo Auctions price-check: %d figures", len(figures))

        async def _fetch():
            nonlocal matched, listings_created, errors, processed
            scraper = YahooAuctionScraper()
            try:
                for fig in figures:
                    processed += 1
                    # Stamp scan time up front so a figure is marked scanned even
                    # if it matches nothing — prevents re-grinding zero-match names.
                    fig.yahoo_scanned_at = datetime.now(timezone.utc)
                    # Build search query from Japanese name
                    query = fig.original_name or ""
                    # Check if original_name is purely Chinese (no katakana/hiragana)
                    has_japanese = bool(re.search(r"[\u3040-\u309F\u30A0-\u30FF]", query))
                    if not has_japanese and query:
                        continue
                    # Shorten to 35 chars, leave room for figure keyword
                    if len(query) > 35:
                        query = query[:35].rsplit(" ", 1)[0]
                    # Always append figure keyword to filter out non-figure merch
                    if "\u30d5\u30a3\u30ae\u30e5\u30a2" not in query and "figure" not in query.lower():
                        query = query + " \u30d5\u30a3\u30ae\u30e5\u30a2"
                    # Add scale if available
                    if fig.scale and fig.scale not in query:
                        query = query + " " + fig.scale
                    try:
                        results = await scraper.search_completed(query, limit=20)
                        if not results:
                            await _asyncio.sleep(_random.uniform(3.0, 6.0))
                            continue

                        matched += 1
                        # Yahoo: 3 top candidates per figure (LLM gate caps cost).
                        for r in results[:3]:
                            if r["source_id"]:
                                existing = session.query(Listing).filter(
                                    Listing.source == "yahoo_auction",
                                    Listing.source_id == r["source_id"],
                                ).first()
                                if existing:
                                    continue

                            # Skip cheap items (not scale figures)
                            if r["price_jpy"] < 3000:
                                continue
                            # Price sanity check
                            if fig.retail_price and r["price_jpy"] > 0:
                                ratio = r["price_jpy"] / fig.retail_price
                                if ratio > 5.0 or ratio < 0.05:
                                    continue

                            # Filter out non-figure items & flag for review
                            if not is_valid_figure_listing(r["title"]):
                                is_valid, reason = validate_listing(r["title"])
                                if not is_valid:
                                    # Dedup by URL — same blocked auction shows up
                                    # across runs; one report per URL is enough.
                                    _url = r.get("url") or ""
                                    _dupe = _url and session.query(ErrorReport).filter(
                                        ErrorReport.report_type == "suspicious_listing",
                                        ErrorReport.description.like(f"%{_url}%"),
                                    ).first()
                                    if not _dupe:
                                        session.add(ErrorReport(
                                            figure_id=fig.id,
                                            report_type="suspicious_listing",
                                            description=(
                                                f"[Yahoo] 疑似非公仔商品: {reason}"
                                                f"\nTitle: {r['title']}"
                                                f"\nURL: {_url or 'N/A'}"
                                            ),
                                            status="pending",
                                        )
                                        )
                                        logger.info("Flagged suspicious Yahoo listing: %s", r["title"][:50])
                                continue

                            # Filter out wrong figure types (e.g. Nendoroid in scale figure results)
                            if not listing_matches_figure_type(r["title"], fig.figure_type, fig.scale):
                                continue

                            # Final LLM gate: existing regex/signal filters miss subtle
                            # mismatches like "same character, different version" or
                            # "shortened title that drops the distinguishing tag".
                            # Cached in Redis, so the second-day run is free for the
                            # same (figure, title) pair.
                            from llm_match import check_match
                            fig_dict = {
                                "id": fig.id, "name": fig.name,
                                "original_name": fig.original_name,
                                "manufacturer": fig.manufacturer, "scale": fig.scale,
                                "retail_price": fig.retail_price,
                                "retail_currency": fig.retail_currency or "JPY",
                            }
                            verdict = check_match(fig_dict, r["title"])
                            if not verdict.accept or verdict.confidence < 0.7:
                                # LLM rejected or low confidence — skip silently.
                                # `llm_unavailable` returns accept=True with conf 0.5, so
                                # those fall through to here and are also skipped (defensive).
                                # If we wanted "fail open", flip the condition; for now
                                # we prefer accuracy over coverage.
                                if verdict.reason != "llm_unavailable":
                                    logger.debug(
                                        "LLM rejected fig=%d title=%r conf=%.2f reason=%s",
                                        fig.id, r["title"][:60], verdict.confidence, verdict.reason,
                                    )
                                    continue
                                # LLM down — fall through and accept based on regex/signal pass.

                            try:
                                listing = Listing(
                                    figure_id=fig.id,
                                    source="yahoo_auction",
                                    source_id=r["source_id"],
                                    title=r["title"],
                                    price=r["price_jpy"],
                                    currency="JPY",
                                    price_canonical=round(_to_canonical_twd(r["price_jpy"], "JPY"), 2),
                                    condition=r.get("condition", "used"),
                                    is_sold=True,
                                    url=r["url"],
                                    image_url=r.get("image_url"),
                                    # endTime from Yahoo's __NEXT_DATA__ is the auction
                                    # close time = sold_at for closedsearch results.
                                    sold_at=r.get("sold_at"),
                                )
                                session.add(listing)
                                session.flush()
                                listings_created += 1
                            except Exception:
                                session.rollback()
                    except Exception:
                        errors += 1
                        if errors <= 5:
                            logger.exception("Yahoo search failed: %s", fig.original_name[:30] if fig.original_name else "?")

                    await _asyncio.sleep(_random.uniform(4.0, 8.0))
            finally:
                await scraper.close()

        _asyncio.run(_fetch())
        session.commit()
        logger.info(
            "Yahoo Auctions done: %d processed, %d matched, %d listings, %d errors",
            processed, matched, listings_created, errors,
        )
    except Exception:
        session.rollback()
        logger.exception("Yahoo Auctions scrape failed")
    finally:
        session.close()

    return {"processed": processed, "matched": matched, "listings": listings_created, "errors": errors}




# ---------------------------------------------------------------------------
# Phase 2: Generate price snapshots from listings
# ---------------------------------------------------------------------------

@app.task(name="generate_price_snapshots", bind=True, max_retries=1, default_retry_delay=60)
def generate_price_snapshots(self) -> dict:
    """Aggregate listings into daily price snapshots per figure per condition.
    Creates 3 snapshot rows per figure per day: all, sealed, used.
    Also updates the figure current avg_price and median_price.

    Aggregation logic comes from `currency.aggregate_prices` (mirrored from
    `api/currency.py`) so this matches the API's `recalculate_figure_snapshots`.
    """
    from currency import aggregate_prices

    session = SessionLocal()
    created = 0
    updated = 0
    errors = 0
    today = date.today()

    try:
        figure_ids = [
            row[0] for row in
            session.query(Listing.figure_id).filter(
                Listing.figure_id.isnot(None),
                Listing.price_canonical.isnot(None),
                Listing.price_canonical > 0,
            ).distinct().all()
        ]

        logger.info("Generating snapshots for %d figures with listings", len(figure_ids))

        for fig_id in figure_ids:
            try:
                # Recent window first; fall back to all-time when no recent activity.
                window_start = today - timedelta(days=30)
                all_listings = session.query(Listing.price_canonical, Listing.condition).filter(
                    Listing.figure_id == fig_id,
                    Listing.price_canonical.isnot(None),
                    Listing.price_canonical > 0,
                    or_(
                        and_(Listing.sold_at.isnot(None), Listing.sold_at >= window_start),
                        and_(Listing.sold_at.is_(None), Listing.scraped_at >= window_start),
                    ),
                ).all()
                if not all_listings:
                    all_listings = session.query(Listing.price_canonical, Listing.condition).filter(
                        Listing.figure_id == fig_id,
                        Listing.price_canonical.isnot(None),
                        Listing.price_canonical > 0,
                    ).all()
                if not all_listings:
                    continue

                # Bucket prices by condition; "all" holds every listing.
                prices_by_cond: dict[str, list[float]] = {
                    "all": [], "sealed": [], "opened": [], "used": [], "damaged": [],
                }
                for price_canonical, cond in all_listings:
                    prices_by_cond["all"].append(float(price_canonical))
                    bucket = cond if cond in ("sealed", "opened", "used", "damaged") else "used"
                    prices_by_cond[bucket].append(float(price_canonical))

                for cond, prices in prices_by_cond.items():
                    if not prices:
                        continue
                    agg = aggregate_prices(prices, trim_pct=10)

                    existing = session.query(PriceSnapshot).filter(
                        PriceSnapshot.figure_id == fig_id,
                        PriceSnapshot.date == today,
                        PriceSnapshot.condition == cond,
                    ).first()

                    if existing:
                        existing.avg_price = agg["avg"]
                        existing.median_price = agg["median"]
                        existing.min_price = agg["min"]
                        existing.max_price = agg["max"]
                        existing.sample_count = agg["count"]
                        updated += 1
                    else:
                        session.add(PriceSnapshot(
                            figure_id=fig_id, date=today, condition=cond,
                            avg_price=agg["avg"], median_price=agg["median"],
                            min_price=agg["min"], max_price=agg["max"], sample_count=agg["count"],
                        ))
                        created += 1

                # Cache figure-level current prices using the same aggregation.
                if prices_by_cond["all"]:
                    fig = session.query(Figure).filter(Figure.id == fig_id).first()
                    if fig:
                        overall = aggregate_prices(prices_by_cond["all"], trim_pct=10)
                        fig.avg_price = overall["avg"]
                        fig.median_price = overall["median"]

            except Exception:
                errors += 1
                if errors <= 5:
                    logger.exception("Snapshot error for figure %d", fig_id)
                continue
        
        session.commit()
        logger.info("Snapshots done: %d created, %d updated, %d errors", created, updated, errors)
        
        # --- Carry forward: copy yesterday's snapshot for figures with no new data today ---
        carried = 0
        try:
            from sqlalchemy import func, or_, and_ as _func, and_
            # Figures that have at least one snapshot but none for today
            figs_with_snapshots = session.query(PriceSnapshot.figure_id).filter(
                PriceSnapshot.date < today
            ).distinct().subquery()
            
            figs_with_today = session.query(PriceSnapshot.figure_id).filter(
                PriceSnapshot.date == today
            ).distinct().subquery()
            
            missing_today = session.query(figs_with_snapshots.c.figure_id).filter(
                ~figs_with_snapshots.c.figure_id.in_(
                    session.query(figs_with_today.c.figure_id)
                )
            ).all()
            
            for (fid,) in missing_today:
                # Get the most recent snapshots for this figure (one per condition)
                latest_date = session.query(_func.max(PriceSnapshot.date)).filter(
                    PriceSnapshot.figure_id == fid,
                    PriceSnapshot.date < today,
                ).scalar()
                if not latest_date:
                    continue
                latest_snaps = session.query(PriceSnapshot).filter(
                    PriceSnapshot.figure_id == fid,
                    PriceSnapshot.date == latest_date,
                ).all()
                for s in latest_snaps:
                    new_snap = PriceSnapshot(
                        figure_id=fid,
                        date=today,
                        avg_price=s.avg_price,
                        median_price=s.median_price,
                        min_price=s.min_price,
                        max_price=s.max_price,
                        sample_count=s.sample_count,
                        condition=s.condition,
                    )
                    session.add(new_snap)
                    carried += 1
            session.commit()
            logger.info("Carry-forward: %d snapshot rows created for figures with no new data today", carried)
        except Exception:
            session.rollback()
            logger.exception("Carry-forward failed")
    except Exception:
        session.rollback()
        logger.exception("Snapshot generation failed")
    finally:
        session.close()
    
    return {"created": created, "updated": updated, "errors": errors}

# Beat schedule: run scraping tasks periodically


# ---------------------------------------------------------------------------
# Phase 2b: Refresh current prices (lightweight, runs every 15 min)
# ---------------------------------------------------------------------------

@app.task(name="refresh_current_prices", bind=True, max_retries=1, default_retry_delay=30)
def refresh_current_prices(self) -> dict:
    """Update Figure.avg_price and median_price from current listings.
    Lightweight task — no new DB rows, just UPDATEs."""
    from statistics import median as _median

    session = SessionLocal()
    updated = 0
    errors = 0

    try:
        figure_ids = [
            row[0] for row in
            session.query(Listing.figure_id).filter(
                Listing.figure_id.isnot(None),
                Listing.price_canonical.isnot(None),
                Listing.price_canonical > 0,
            ).distinct().all()
        ]

        for fig_id in figure_ids:
            try:
                all_listings = session.query(Listing.price_canonical).filter(
                    Listing.figure_id == fig_id,
                    Listing.price_canonical.isnot(None),
                    Listing.price_canonical > 0,
                ).all()

                prices = sorted([float(r[0]) for r in all_listings])
                if not prices:
                    continue

                n = len(prices)
                if n >= 5:
                    tc = max(1, n // 10)
                    trimmed = prices[tc:-tc]
                    avg_p = round(sum(trimmed) / len(trimmed), 2)
                else:
                    avg_p = round(sum(prices) / n, 2)
                med_p = round(_median(prices), 2)

                fig = session.query(Figure).filter(Figure.id == fig_id).first()
                if fig and (fig.avg_price != avg_p or fig.median_price != med_p):
                    fig.avg_price = avg_p
                    fig.median_price = med_p
                    updated += 1

            except Exception:
                errors += 1

        session.commit()
        logger.info("Price refresh done: %d updated, %d errors", updated, errors)
    except Exception:
        session.rollback()
        logger.exception("Price refresh failed")
    finally:
        session.close()

    return {"updated": updated, "errors": errors}


# ---------------------------------------------------------------------------
# Phase 1c: Scrape Rakuma sold listings
# ---------------------------------------------------------------------------

@app.task(name="scrape_rakuma_prices", bind=True, max_retries=1, default_retry_delay=300)
def scrape_rakuma_prices(self, batch_size: int = 30) -> dict:
    """Scrape sold figure listings from Rakuma (fril.jp)."""
    import asyncio as _asyncio
    import random as _random
    from scrapers.rakuma import RakumaScraper
    from listing_validator import validate_listing

    session = SessionLocal()
    processed = 0
    matched = 0
    listings_created = 0
    errors = 0
    flagged = 0

    try:
        # Get figures to search for (prioritize those with Japanese names)
        figures = session.query(Figure).filter(
            Figure.original_name.isnot(None),
            Figure.original_name != "",
            Figure.retail_price.isnot(None),
            or_(Figure.retail_price > 4500, Figure.retail_price.is_(None)),
        ).order_by(
            Figure.view_count.desc().nullslast(), Figure.id
        ).limit(batch_size).all()

        logger.info("Rakuma: searching for %d figures", len(figures))

        async def _fetch():
            nonlocal processed, matched, listings_created, errors, flagged
            scraper = RakumaScraper()

            try:
                for fig in figures:
                    processed += 1
                    # Build search query from Japanese name
                    query = fig.original_name
                    if not query:
                        continue

                    # Shorten query if too long (Rakuma search works better with shorter queries)
                    if len(query) > 40:
                        query = query[:40]

                    try:
                        results = await scraper.search_sold(query, max_pages=1)

                        for r in results:
                            if not is_valid_figure_listing(r["title"]):
                                # Flag for admin review
                                flagged += 1
                                continue

                            # Check for duplicates
                            source_id = r["url"].split("/")[-1] if r["url"] else None
                            if not source_id:
                                continue

                            existing = session.query(Listing).filter(
                                Listing.source == "rakuma",
                                Listing.source_id == source_id,
                            ).first()
                            if existing:
                                continue

                            matched += 1

                            # Compute the canonical TWD value used by snapshot ranking.
                            price_canonical = round(_to_canonical_twd(r["price"], "JPY"), 2)

                            # Create listing
                            from datetime import datetime, timezone
                            sold_at = None
                            if r.get("sold_ts"):
                                sold_at = datetime.fromtimestamp(r["sold_ts"], tz=timezone.utc)

                            listing = Listing(
                                figure_id=fig.id,
                                source="rakuma",
                                source_id=source_id,
                                title=r["title"],
                                price=r["price"],
                                currency="JPY",
                                price_canonical=price_canonical,
                                condition=r.get("condition", "used"),
                                is_sold=True,
                                sold_at=sold_at,
                                url=r["url"],
                            )
                            session.add(listing)
                            listings_created += 1

                    except Exception:
                        errors += 1
                        if errors <= 5:
                            logger.exception("Rakuma search failed: %s", query[:30])

                    await _asyncio.sleep(_random.uniform(2.0, 4.0))
            finally:
                await scraper.close()

        _asyncio.run(_fetch())
        session.commit()
        logger.info(
            "Rakuma done: %d processed, %d matched, %d listings, %d flagged, %d errors",
            processed, matched, listings_created, flagged, errors,
        )
    except Exception:
        session.rollback()
        logger.exception("Rakuma scrape failed")
    finally:
        session.close()

    return {"processed": processed, "matched": matched, "listings": listings_created, "errors": errors}


app.conf.beat_schedule = {
    "enrich-figures-daily": {
        "task": "enrich_figures",
        "schedule": 86400,  # every 24 hours
        "kwargs": {"batch_size": 500, "min_price_jpy": 0},
    },
    # Yahoo scraper — LLM-validated matching (see llm_match.py).
    # batch_size 300→120 (2026-07-01): with the refresh-oriented selection now
    # feeding it POPULAR figures that actually return candidates (~84% produce a
    # listing vs the old ~0.3%), each figure costs ~20s of real search+LLM work
    # instead of a fast 0-candidate skip. 120 keeps the run ~45 min; STALE_DAYS=21
    # means the top ~2,500 figures by views cycle back for fresh prices ~monthly.
    "scrape-yahoo-every-24h": {
        "task": "scrape_yahoo_prices",
        "schedule": 86400,
        "kwargs": {"batch_size": 120},
    },
    # Mercari scraper — Playwright-driven. Runs every 12h since Mercari has
    # ~3-5× more daily sold listings than Yahoo and is the main data moat.
    "scrape-mercari-every-12h": {
        "task": "scrape_mercari_prices",
        "schedule": 43200,
        "kwargs": {"batch_size": 30},
    },
    # AmiAmi preowned — DISABLED as an automated source. The reverse-pull task
    # works, but AmiAmi's Cloudflare bans the server IP after ~50 requests, and
    # matching AmiAmi's English-only titles against our JP/CN figure names tops
    # out at ~92% accuracy (the LLM cannot reliably equate cross-lingual
    # character names it doesn't know). It is kept as a MANUAL backfill tool:
    # pull from a clean IP, run scrape_amiami_preowned, human-review the ~8%
    # questionable matches before they go live. One backfill of 72 verified
    # listings was done 2026-05-17.
    # "scrape-amiami-every-24h": {
    #     "task": "scrape_amiami_preowned",
    #     "schedule": 86400,
    # },
    # Mercari disabled — requires Playwright browser rendering
    # "scrape-mercari-every-12h": {
    #     "task": "scrape_mercari_prices",
    #     "schedule": 43200,
    #     "kwargs": {"batch_size": 30},
    # },
    # Snapshots disabled — chart now renders from raw listings
    # "generate-snapshots-daily": {
    #     "task": "generate_price_snapshots",
    #     "schedule": 86400,
    # },
    "refresh-prices-every-15m": {
        "task": "refresh_current_prices",
        "schedule": 900,  # every 15 minutes
    },
    # Hpoi new-release discovery — weekly. order="new" surfaces the most
    # recently-ADDED Hpoi entries (id desc); dedup by source_id (hpoi_id) makes
    # re-scans idempotent, so the 20-page (~600 item) window gives ample
    # week-to-week overlap and nothing slips between runs. This is the ONLY task
    # that creates new figure rows — the daily enrich_figures task then fills in
    # image/manufacturer/character/etc. for the freshly-created shells
    # (it targets image_url IS NULL AND source_id IS NOT NULL). Mon 03:00 UTC
    # (= 11:00 Asia/Taipei); beat runs in UTC (see app.conf.timezone above).
    "import-hpoi-new-weekly": {
        "task": "import_hpoi_catalog",
        "schedule": crontab(day_of_week=1, hour=3, minute=0),
        "kwargs": {"order": "new", "max_pages": 20},
    },
    # Rakuma scraper disabled until matching is improved
    # "scrape-rakuma-every-12h": {
    #     "task": "scrape_rakuma_prices",
    #     "schedule": 43200,
    #     "kwargs": {"batch_size": 30},
    # },
}


if __name__ == "__main__":
    app.worker_main(["worker", "--beat", "--loglevel=info", "--concurrency=3"])
