"""Rakuma (fril.jp) sold listings scraper."""

import asyncio
import logging
import random
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://fril.jp"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.7",
    "Referer": "https://fril.jp/",
}

# Condition mapping from Rakuma Japanese to our system
CONDITION_MAP = {
    "新品、未使用": "sealed",
    "未使用に近い": "sealed",
    "目立った傷や汚れなし": "opened",
    "やや傷や汚れあり": "used",
    "傷や汚れあり": "damaged",
    "全体的に状態が悪い": "damaged",
}


def parse_search_results(html: str) -> list[dict[str, Any]]:
    """Parse Rakuma search results page. Returns list of sold listings."""
    soup = BeautifulSoup(html, "html.parser")
    results = []

    for item in soup.select("div.item-box"):
        try:
            # Check if sold
            if not item.select_one("div.item-box__soldout_ribbon"):
                continue

            link_el = item.select_one("a.link_search_image")
            if not link_el:
                continue

            url = link_el.get("href", "")
            price = link_el.get("data-rat-price")
            title_el = item.select_one("p.item-box__item-name span")
            title = title_el.get_text(strip=True) if title_el else ""

            if not price or not title:
                continue

            # Extract timestamp from image URL (?{unix_ts})
            img_el = item.select_one("img[data-original]")
            sold_ts = None
            if img_el:
                img_url = img_el.get("data-original", "")
                ts_match = re.search(r"\?(\d{10})", img_url)
                if ts_match:
                    sold_ts = int(ts_match.group(1))

            results.append({
                "title": title,
                "price": int(price),
                "currency": "JPY",
                "url": url,
                "source": "rakuma",
                "sold_ts": sold_ts,
                "condition": "used",  # default, updated from detail page
            })

        except Exception as e:
            logger.debug("Failed to parse item: %s", e)
            continue

    return results


def parse_detail_condition(html: str) -> str:
    """Extract condition from Rakuma detail page."""
    soup = BeautifulSoup(html, "html.parser")

    # Look for condition in product detail table
    for td in soup.select("td"):
        text = td.get_text(strip=True)
        if text in CONDITION_MAP:
            return CONDITION_MAP[text]

    # Fallback: check Schema.org
    for script in soup.select("script[type='application/ld+json']"):
        try:
            import json
            data = json.loads(script.string or "{}")
            cond = data.get("itemCondition", "")
            if "NewCondition" in cond:
                return "sealed"
            elif "UsedCondition" in cond:
                return "used"
        except Exception:
            pass

    return "used"


class RakumaScraper:
    """Scrapes sold PVC figure listings from Rakuma (fril.jp)."""

    def __init__(self) -> None:
        self.client: httpx.AsyncClient | None = None
        self._request_count = 0

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None or self.client.is_closed:
            self.client = httpx.AsyncClient(
                headers=HEADERS, timeout=30.0, follow_redirects=True
            )
        return self.client

    async def close(self) -> None:
        if self.client and not self.client.is_closed:
            await self.client.aclose()

    async def search_sold(
        self, query: str, max_pages: int = 3, category_id: int = 815
    ) -> list[dict[str, Any]]:
        """Search for sold listings on Rakuma."""
        client = await self._get_client()
        all_results = []

        for page in range(1, max_pages + 1):
            self._request_count += 1
            params = {
                "query": query,
                "transaction": "soldout",
                "sort": "created_at",
                "order": "desc",
                "category_id": str(category_id),
                "page": str(page),
            }

            for attempt in range(3):
                try:
                    resp = await client.get(f"{BASE_URL}/s", params=params)
                    if resp.status_code == 429:
                        wait = 15 * (attempt + 1)
                        logger.warning("Rate limited, waiting %ds", wait)
                        await asyncio.sleep(wait)
                        continue
                    if resp.status_code == 404:
                        return all_results  # No more pages
                    resp.raise_for_status()

                    items = parse_search_results(resp.text)
                    if not items:
                        return all_results  # No more results

                    all_results.extend(items)
                    await asyncio.sleep(random.uniform(1.0, 2.0))
                    break

                except httpx.HTTPStatusError:
                    await asyncio.sleep(5)
                except httpx.RequestError as e:
                    logger.warning("Request error: %s", e)
                    await asyncio.sleep(5)

        return all_results

    async def get_condition(self, url: str) -> str:
        """Fetch detail page to get condition."""
        client = await self._get_client()
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                return parse_detail_condition(resp.text)
        except Exception as e:
            logger.debug("Failed to get condition from %s: %s", url, e)
        return "used"
