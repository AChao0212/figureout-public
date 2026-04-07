"""Yahoo Auctions Japan completed auctions scraper — using __NEXT_DATA__ JSON."""

import json
import logging
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Keywords that indicate sealed/new condition
SEALED_KEYWORDS = re.compile(
    r"新品|未開封|未使用|新品未開封|sealed|brand.?new|未開|MISB|新品未使用",
    re.IGNORECASE,
)

# Keywords for opened but not displayed
OPENED_KEYWORDS = re.compile(
    r"開封済|開封品|一度開封|箱から出し|中身確認",
    re.IGNORECASE,
)

# Keywords for damaged items
DAMAGED_KEYWORDS = re.compile(
    r"ジャンク|難あり|破損|欠品|欠損|パーツ欠|箱なし|箱潰れ|箱破れ|箱ダメージ|箱傷|傷あり|傷有|汚れ|塗装剥|塗装ハゲ|日焼け|黄ばみ",
    re.IGNORECASE,
)


def detect_condition(title: str) -> str:
    """Detect condition from auction title."""
    if DAMAGED_KEYWORDS.search(title):
        return "damaged"
    if SEALED_KEYWORDS.search(title):
        return "sealed"
    if OPENED_KEYWORDS.search(title):
        return "opened"
    return "used"


class YahooAuctionScraper:
    """Scrape completed auctions from Yahoo Auctions Japan via __NEXT_DATA__."""

    BASE = "https://auctions.yahoo.co.jp"

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "ja,en;q=0.9",
            },
        )

    async def close(self):
        await self.client.aclose()

    async def search_completed(self, query: str, limit: int = 30) -> list[dict[str, Any]]:
        """Search completed auctions on Yahoo Auctions Japan."""
        url = f"{self.BASE}/closedsearch/closedsearch"
        params = {
            "p": query,
            "va": query,
            "n": str(min(limit, 50)),
        }
        try:
            resp = await self.client.get(url, params=params)
            if resp.status_code != 200:
                logger.warning("Yahoo Auctions search %d for %s", resp.status_code, query)
                return []
            return self._parse_next_data(resp.text)
        except Exception:
            logger.exception("Yahoo Auctions search failed for %s", query)
            return []

    def _parse_next_data(self, html: str) -> list[dict[str, Any]]:
        """Parse auction results from __NEXT_DATA__ JSON embedded in page."""
        soup = BeautifulSoup(html, "html.parser")
        script = soup.find("script", id="__NEXT_DATA__")
        if not script or not script.string:
            logger.warning("No __NEXT_DATA__ found in Yahoo page")
            return self._parse_results_fallback(soup)

        try:
            data = json.loads(script.string)
            listing = (
                data.get("props", {})
                .get("pageProps", {})
                .get("initialState", {})
                .get("search", {})
                .get("items", {})
                .get("listing", {})
            )
            items = listing.get("items", [])
            if not items:
                return []

            results = []
            for item in items:
                try:
                    auction_id = item.get("auctionId", "")
                    title = item.get("title", "")
                    if not title or not auction_id:
                        continue

                    # Price: use currentPrice (winning price for completed auctions)
                    price_jpy = item.get("currentPrice") or item.get("price") or item.get("buyNowPrice", 0)
                    if not price_jpy or price_jpy <= 0:
                        continue

                    # Image
                    img_url = item.get("image", "") or item.get("imageUrl", "")

                    # Bids
                    bids = item.get("bidCount", 0)

                    # URL
                    url = f"{self.BASE}/jp/auction/{auction_id}"

                    # Condition
                    condition = detect_condition(title)

                    results.append({
                        "title": title,
                        "price_jpy": int(price_jpy),
                        "url": url,
                        "image_url": img_url,
                        "source_id": auction_id,
                        "condition": condition,
                        "is_sold": True,
                        "bids": bids,
                    })
                except Exception:
                    continue

            return results
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to parse __NEXT_DATA__: %s", e)
            return []

    def _parse_results_fallback(self, soup: BeautifulSoup) -> list[dict[str, Any]]:
        """Fallback HTML parser for older Yahoo layout."""
        results = []
        for item in soup.select(".Product"):
            try:
                title_el = item.select_one(".Product__titleLink") or item.select_one("a.Product__imageLink")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                url = title_el.get("href", "")

                source_id = ""
                id_match = re.search(r'/([a-z]\d+)', url)
                if id_match:
                    source_id = id_match.group(1)

                price_el = item.select_one(".Product__priceValue") or item.select_one(".Product__price")
                if not price_el:
                    continue
                price_text = price_el.get_text(strip=True)
                price_match = re.search(r'([\d,]+)', price_text)
                if not price_match:
                    continue
                price_jpy = int(price_match.group(1).replace(",", ""))

                img_el = item.select_one("img")
                img_url = img_el.get("src", "") if img_el else ""

                bids_el = item.select_one(".Product__bid")
                bids = 0
                if bids_el:
                    bids_match = re.search(r'(\d+)', bids_el.get_text())
                    if bids_match:
                        bids = int(bids_match.group(1))

                condition = detect_condition(title)

                results.append({
                    "title": title,
                    "price_jpy": price_jpy,
                    "url": url,
                    "image_url": img_url,
                    "source_id": source_id,
                    "condition": condition,
                    "is_sold": True,
                    "bids": bids,
                })
            except Exception:
                continue
        return results
