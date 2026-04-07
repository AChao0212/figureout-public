"""Mercari Japan completed sales scraper — real peer-to-peer transaction prices."""

import asyncio
import logging
import random
import re
from typing import Any

import httpx

import re as _re

_SEALED_RE = _re.compile(r"新品|未開封|未使用|sealed|brand.?new|MISB", _re.IGNORECASE)
_DAMAGED_RE = _re.compile(r"ジャンク|難あり|破損|欠品|箱なし|箱潰れ|傷あり|傷有|日焼け|黄ばみ", _re.IGNORECASE)
_OPENED_RE = _re.compile(r"開封済|開封品|一度開封|中身確認", _re.IGNORECASE)

def _detect_cond(title: str) -> str:
    if _DAMAGED_RE.search(title): return "damaged"
    if _SEALED_RE.search(title): return "sealed"
    if _OPENED_RE.search(title): return "opened"
    return "used"


logger = logging.getLogger(__name__)


class MercariScraper:
    """Scrape completed (sold) listings from Mercari Japan search API."""

    SEARCH_URL = "https://api.mercari.jp/v2/entities:search"

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json, text/plain, */*",
                "X-Platform": "web",
                "Dpop": "",
            },
        )

    async def close(self):
        await self.client.aclose()

    async def search_sold(self, query: str, limit: int = 30) -> list[dict[str, Any]]:
        """Search for completed/sold items on Mercari."""
        # Mercari web search URL (scrape HTML since API needs auth)
        url = "https://jp.mercari.com/search"
        params = {
            "keyword": query,
            "status": "sold_out",
            "category_id": "1328",  # Figures category
            "sort": "created_time",
            "order": "desc",
        }
        try:
            resp = await self.client.get(url, params=params)
            if resp.status_code != 200:
                logger.warning("Mercari search %d for %s", resp.status_code, query)
                return []
            return self._parse_search_html(resp.text)
        except Exception:
            logger.exception("Mercari search failed for %s", query)
            return []

    def _parse_search_html(self, html: str) -> list[dict[str, Any]]:
        """Parse Mercari search results from HTML."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        results = []

        # Mercari uses data attributes on item cards
        for item in soup.select('[data-testid="item-cell"]'):
            try:
                # Title
                title_el = item.select_one('[data-testid="thumbnail-link"]') or item.select_one("a")
                if not title_el:
                    continue
                href = title_el.get("href", "")
                item_id = ""
                id_match = re.search(r"/item/(\w+)", href)
                if id_match:
                    item_id = id_match.group(1)
                url = f"https://jp.mercari.com/item/{item_id}" if item_id else ""

                # Name from aria-label or img alt
                name_el = item.select_one("img")
                title = name_el.get("alt", "") if name_el else ""

                # Price
                price_el = item.select_one('[class*="Price"]') or item.select_one('[class*="price"]')
                if not price_el:
                    # Try finding price pattern in text
                    text = item.get_text()
                    price_match = re.search(r'[¥￥][\s]*([\d,]+)', text)
                    if price_match:
                        price_jpy = int(price_match.group(1).replace(",", ""))
                    else:
                        continue
                else:
                    price_text = price_el.get_text(strip=True)
                    price_match = re.search(r'([\d,]+)', price_text)
                    if not price_match:
                        continue
                    price_jpy = int(price_match.group(1).replace(",", ""))

                # Image
                img_url = name_el.get("src", "") if name_el else ""

                results.append({
                    "title": title,
                    "price_jpy": price_jpy,
                    "url": url,
                    "image_url": img_url,
                    "source_id": item_id,
                    "condition": _detect_cond(item.get("name", "")),
                    "is_sold": True,
                })
            except Exception:
                continue

        # Fallback: try JSON-LD or script data
        if not results:
            for script in soup.select('script[type="application/json"]'):
                try:
                    import json
                    data = json.loads(script.string or "")
                    # Navigate Mercari's data structure
                    if isinstance(data, dict):
                        items = self._extract_items_from_json(data)
                        results.extend(items)
                except Exception:
                    continue

        return results

    def _extract_items_from_json(self, data: dict, depth: int = 0) -> list[dict]:
        """Recursively search for item data in Mercari's JSON."""
        if depth > 5:
            return []
        results = []
        
        # Look for item-like structures
        if "id" in data and "price" in data and "name" in data:
            try:
                results.append({
                    "title": str(data.get("name", "")),
                    "price_jpy": int(data.get("price", 0)),
                    "url": f"https://jp.mercari.com/item/{data['id']}",
                    "image_url": "",
                    "source_id": str(data["id"]),
                    "condition": _detect_cond(item.get("name", "") if isinstance(item, dict) else ""),
                    "is_sold": True,
                })
            except (ValueError, TypeError):
                pass
        
        for key, val in data.items():
            if isinstance(val, dict):
                results.extend(self._extract_items_from_json(val, depth + 1))
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        results.extend(self._extract_items_from_json(item, depth + 1))
        
        return results
