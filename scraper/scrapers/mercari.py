"""Mercari Japan completed-sales scraper, Playwright edition.

The HTML returned by `https://jp.mercari.com/search` is a Next.js shell — actual
search results hydrate client-side, so plain `httpx` returns an empty page. This
module drives a real Chromium via Playwright so we see the rendered cards.

Same public surface as the legacy `MercariScraper`:
    async with MercariScraper() as s:
        results = await s.search_sold(query, limit=30)

Each result dict has: title, price_jpy, url, image_url, source_id, condition,
is_sold. Identical schema to the Yahoo scraper so the scrape task code can swap.
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote_plus

from playwright.async_api import async_playwright, Browser, BrowserContext

logger = logging.getLogger(__name__)

# Mercari shows sold-at as a Japanese relative time ("9時間前", "3日前", "2ヶ月前").
# We resolve it against the scrape time so the listing gets a real `sold_at`
# datetime, which the price-history chart needs to plot trends.
_REL_TIME_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(\d+)\s*分前"), "minutes"),
    (re.compile(r"(\d+)\s*時間前"), "hours"),
    (re.compile(r"(\d+)\s*日前"), "days"),
    (re.compile(r"(\d+)\s*週間?前"), "weeks"),
    (re.compile(r"(\d+)\s*ヶ?月前"), "months"),
    (re.compile(r"(\d+)\s*年前"), "years"),
]


def _parse_relative_time(text: str, now: datetime | None = None) -> datetime | None:
    """Convert a Japanese relative-time string to an absolute UTC datetime.

    Returns None if no recognised pattern matches. Months are approximated as
    30 days and years as 365 days — Mercari listings rarely care about better
    precision than the day, and we round to date anyway."""
    if not text:
        return None
    now = now or datetime.now(timezone.utc)
    for pat, unit in _REL_TIME_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        n = int(m.group(1))
        if unit == "minutes":
            return now - timedelta(minutes=n)
        if unit == "hours":
            return now - timedelta(hours=n)
        if unit == "days":
            return now - timedelta(days=n)
        if unit == "weeks":
            return now - timedelta(weeks=n)
        if unit == "months":
            return now - timedelta(days=n * 30)
        if unit == "years":
            return now - timedelta(days=n * 365)
    return None

_SEALED_RE = re.compile(r"新品|未開封|未使用|sealed|brand.?new|MISB", re.IGNORECASE)
_DAMAGED_RE = re.compile(r"ジャンク|難あり|破損|欠品|箱なし|箱潰れ|傷あり|傷有|日焼け|黄ばみ", re.IGNORECASE)
_OPENED_RE = re.compile(r"開封済|開封品|一度開封|中身確認", re.IGNORECASE)


def _detect_cond(title: str) -> str:
    if _DAMAGED_RE.search(title): return "damaged"
    if _SEALED_RE.search(title): return "sealed"
    if _OPENED_RE.search(title): return "opened"
    return "used"


# Skip the category_id filter — Mercari's "figures" category (1328) excludes too
# many genuine matches (sets, partial lots, accessories) and our LLM gate catches
# non-figure noise anyway. The hpoi catalog + figure name is enough signal.
SEARCH_URL_TMPL = (
    "https://jp.mercari.com/search?keyword={kw}&status=sold_out"
    "&sort=created_time&order=desc"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class MercariScraper:
    """Headless-Chromium-backed Mercari Japan sold-listings scraper.

    Designed as a context manager so the underlying browser is shared across
    queries in the same scrape task — launching Chromium per query would dwarf
    the actual network cost."""

    def __init__(self, headless: bool = True):
        self.headless = headless
        self._pw = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None

    async def __aenter__(self):
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=self.headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        self._context = await self._browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1366, "height": 768},
            locale="ja-JP",
        )
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        if self._context: await self._context.close()
        if self._browser: await self._browser.close()
        if self._pw: await self._pw.stop()
        self._context = self._browser = self._pw = None

    async def fetch_sold_at(self, item_id: str) -> datetime | None:
        """Open a Mercari item detail page and extract the sold-on datetime.

        Mercari only renders a Japanese relative time ("9時間前") on the detail
        page — no absolute timestamp is exposed. We resolve it against now().
        Returns None if the page doesn't load or the time can't be parsed.

        The relative-time element hydrates ~2.5s after DOMContentLoaded; we wait
        a bit then poll briefly so flaky network doesn't lose data."""
        if self._context is None:
            raise RuntimeError("MercariScraper must be used as an async context manager")
        url = f"https://jp.mercari.com/item/{item_id}"
        page = await self._context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            # Poll up to 5s for the relative time to appear post-hydration.
            for _ in range(5):
                await page.wait_for_timeout(1000)
                result = _parse_relative_time(await page.content())
                if result is not None:
                    return result
            return None
        except Exception as e:
            logger.debug("Mercari fetch_sold_at(%s) failed: %s", item_id, e)
            return None
        finally:
            await page.close()

    async def search_sold(self, query: str, limit: int = 30) -> list[dict[str, Any]]:
        """Return up to `limit` sold-listing dicts for `query`. Best-effort: returns []
        on timeouts or hydration failures rather than raising."""
        if self._context is None:
            raise RuntimeError("MercariScraper must be used as an async context manager")

        url = SEARCH_URL_TMPL.format(kw=quote_plus(query))
        page = await self._context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            # Item cells hydrate after initial DOM ready. Wait briefly; if none
            # appear we treat it as "no results" rather than an error.
            try:
                await page.wait_for_selector('[data-testid="item-cell"]', timeout=8000)
            except Exception:
                return []
            html = await page.content()
            return self._parse(html, limit)
        except Exception as e:
            logger.warning("Mercari search failed for %r: %s", query[:40], e)
            return []
        finally:
            await page.close()

    @staticmethod
    def _parse(html: str, limit: int) -> list[dict[str, Any]]:
        """Pull title/price/URL out of Mercari's hydrated item cards.

        Layout (May 2026): each `<li data-testid="item-cell">` wraps a thumbnail
        `<div>` whose `aria-label` is `"<title> 売り切れ <price>円 NT$<usd>"`.
        Title is also duplicated as `<img alt="…のサムネイル">`. Item ID is in
        the anchor href `/item/<id>`."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        results: list[dict[str, Any]] = []
        for item in soup.select('[data-testid="item-cell"]'):
            if len(results) >= limit:
                break
            try:
                link = item.find("a", href=True)
                if not link:
                    continue
                m = re.search(r"/item/([A-Za-z0-9]+)", link["href"])
                if not m:
                    continue
                item_id = m.group(1)

                # Title: prefer aria-label without the trailing price/status text;
                # fall back to img.alt stripped of Mercari's "のサムネイル" suffix.
                title = ""
                thumb_div = item.find(attrs={"aria-label": True})
                if thumb_div:
                    aria = thumb_div.get("aria-label", "")
                    # aria-label looks like "<title>の画像 売り切れ <price>円 NT$..."
                    # Trim once we hit the recognised tail.
                    for tail in ("の画像", " 売り切れ", "のサムネイル"):
                        idx = aria.find(tail)
                        if idx > 0:
                            title = aria[:idx]
                            break
                    if not title:
                        title = aria
                if not title:
                    img = item.find("img")
                    if img:
                        title = (img.get("alt") or "").replace("のサムネイル", "")

                img_el = item.find("img")
                img_url = (img_el.get("src") if img_el else "") or ""

                # Price lives in the aria-label, not text. Look there first; if a
                # listing surfaces price elsewhere (Mercari A/B tests UI), fall back
                # to a global ¥-pattern scan over the cell text.
                price_jpy = 0
                for el in item.find_all(attrs={"aria-label": True}):
                    aria = el.get("aria-label", "")
                    pm = re.search(r"([\d,]+)\s*円", aria)
                    if pm:
                        try:
                            price_jpy = int(pm.group(1).replace(",", ""))
                            break
                        except ValueError:
                            continue
                if not price_jpy:
                    pm = re.search(r"([\d,]+)\s*円", item.get_text(" ", strip=True))
                    if pm:
                        try:
                            price_jpy = int(pm.group(1).replace(",", ""))
                        except ValueError:
                            pass
                if price_jpy <= 0:
                    continue

                results.append({
                    "title": title,
                    "price_jpy": price_jpy,
                    "url": f"https://jp.mercari.com/item/{item_id}",
                    "image_url": img_url,
                    "source_id": item_id,
                    "condition": _detect_cond(title),
                    "is_sold": True,
                })
            except Exception:
                continue
        return results


# Smoke test — `python3 -m scrapers.mercari` runs a search and prints results.
async def _smoke():
    logging.basicConfig(level=logging.INFO)
    async with MercariScraper() as s:
        out = await s.search_sold("時崎狂三 墨色生香", limit=10)
        for r in out:
            print(f"{r['price_jpy']:>6} JPY | {r['source_id']:>14} | {r['title'][:60]}")
        print(f"\n{len(out)} results")


if __name__ == "__main__":
    asyncio.run(_smoke())
