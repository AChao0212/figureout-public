"""Hpoi.net catalog scraper — builds figure database from list pages.

The list page titles are already structured as:
  "franchise character [manufacturer] version"
  e.g. "命运-冠位指定 阿尔托莉雅・潘德拉贡[Alter] 礼服版"

We extract franchise, character, manufacturer from the title pattern.
Detail pages load via JS so we skip them — list page data is sufficient.
"""

import asyncio
import logging
import random
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://www.hpoi.net"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
    "Referer": "https://www.hpoi.net/",
}


def parse_hpoi_title(title: str) -> dict[str, str]:
    """Parse an Hpoi title into structured fields.

    Common patterns:
      "命运-冠位指定 阿尔托莉雅・潘德拉贡[Alter] 礼服版"
      → franchise="命运-冠位指定", character="阿尔托莉雅・潘德拉贡", manufacturer="Alter", version="礼服版"

      "初音未来 16周年纪念款"
      → franchise="初音未来", character="初音未来", version="16周年纪念款"

      "电影 游戏人生：零 休比·多拉"
      → franchise="游戏人生：零", character="休比·多拉"
    """
    result: dict[str, str] = {"name": title, "raw_name": title}

    # Strip prefixes like movie/OVA
    title = re.sub(r"^(电影|剧场版|TV版|OVA|小说)\s+", "", title)

    # Extract manufacturer from [brackets]
    mfr_match = re.search(r"\[([^\]]+)\]", title)
    if mfr_match:
        result["manufacturer"] = mfr_match.group(1).strip()
        title = title[:mfr_match.start()] + title[mfr_match.end():]
        title = title.strip()

    # Extract scale
    scale_match = re.search(r"(1/\d+)", title)
    if scale_match:
        result["scale"] = scale_match.group(1)

    # Try to split franchise and character
    # Hpoi titles typically have franchise first, then character
    # Common separators: space after a known franchise pattern
    parts = title.strip().split(" ", 1)
    if len(parts) == 2:
        result["franchise"] = parts[0].strip()
        # The rest is character + version
        remainder = parts[1].strip()

        # Try to separate character from version
        # Version keywords: Ver., 版, ver, edition
        ver_match = re.search(
            r"(.+?)\s+((?:[\w\-]+Ver\.?|.*?版|.*?[Vv]er\.?\s*\d*|Wedding|Bunny|Swimsuit|China Dress|Maid).*)$",
            remainder,
        )
        if ver_match:
            result["character"] = ver_match.group(1).strip()
            result["version"] = ver_match.group(2).strip()
        else:
            result["character"] = remainder
    else:
        # Single word title — use as both franchise and character
        result["franchise"] = title.strip()
        result["character"] = title.strip()

    # Extract additional info from the character field
    # Remove scale from character name
    if result.get("character"):
        result["character"] = re.sub(r"\s*1/\d+\s*", " ", result["character"]).strip()

    return result


class HpoiScraper:
    """Scraper for Hpoi.net figure catalog — list pages only."""

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

    async def _polite_get(self, url: str, **kwargs) -> httpx.Response | None:
        """GET with rate limiting and retry."""
        client = await self._get_client()
        self._request_count += 1

        if self._request_count % 100 == 0:
            logger.info("Rate limit pause at request %d", self._request_count)
            await asyncio.sleep(random.uniform(5.0, 10.0))

        for attempt in range(3):
            try:
                resp = await client.get(url, **kwargs)
                if resp.status_code == 429:
                    wait = 30 * (attempt + 1)
                    logger.warning("Rate limited, waiting %ds", wait)
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code == 403:
                    logger.warning("Blocked (403), waiting 60s")
                    await asyncio.sleep(60)
                    continue
                resp.raise_for_status()
                return resp
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    return None
                logger.warning("HTTP %s for %s", e.response.status_code, url)
                await asyncio.sleep(5)
            except httpx.RequestError as e:
                logger.warning("Request error: %s", e)
                await asyncio.sleep(5)
        return None

    async def get_list_page(self, page: int = 1, order: str = "rating", category: int = 100) -> list[dict]:
        """Fetch a list page and return parsed figure data.

        Returns list of {hpoi_id, raw_name, franchise, character, manufacturer, ...}
        """
        resp = await self._polite_get(
            f"{BASE_URL}/hobby/all",
            params={"order": order, "page": str(page), "category": str(category)},
        )
        if not resp:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        figures: dict[int, dict] = {}  # hpoi_id -> parsed data

        for a in soup.find_all("a", href=True):
            href = a["href"]
            m = re.match(r"^hobby/(\d+)$", href)
            if not m:
                continue

            hpoi_id = int(m.group(1))
            text = a.get_text(strip=True)

            if not text:
                # First link (image) has no text — register ID
                if hpoi_id not in figures:
                    figures[hpoi_id] = {"hpoi_id": hpoi_id}
                continue

            # Second link has the figure name — parse it
            parsed = parse_hpoi_title(text)
            parsed["hpoi_id"] = hpoi_id
            figures[hpoi_id] = parsed

        # Also extract manufacturer info from the list page context
        # The list page shows "厂商: XXX" near each item
        page_text = soup.get_text()
        mfr_matches = re.findall(r"厂商[：:]\s*(.+?)(?:\s|出荷|浏览|$)", page_text)

        result = [v for v in figures.values() if v.get("raw_name")]
        logger.info("Hpoi page %d (%s): found %d figures", page, order, len(result))
        return result

    async def scrape_catalog(
        self,
        start_page: int = 1,
        max_pages: int = 100,
        order: str = "rating",
    ) -> list[dict]:
        """Scrape catalog list pages and return parsed figure data."""
        all_figures: list[dict] = []
        seen_ids: set[int] = set()
        consecutive_empty = 0

        for page in range(start_page, start_page + max_pages):
            items = await self.get_list_page(page=page, order=order)

            if not items:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    logger.info("3 consecutive empty pages, stopping")
                    break
                continue
            consecutive_empty = 0

            for item in items:
                hpoi_id = item["hpoi_id"]
                if hpoi_id not in seen_ids:
                    seen_ids.add(hpoi_id)
                    all_figures.append(item)

            logger.info(
                "Hpoi progress: page %d/%d, %d figures total",
                page, start_page + max_pages - 1, len(all_figures),
            )

            await asyncio.sleep(random.uniform(1.0, 2.5))

        logger.info("Hpoi scrape complete: %d figures", len(all_figures))
        return all_figures
