"""Hpoi detail page scraper — extracts ALL structured data."""

import asyncio
import logging
import random
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup
from opencc import OpenCC

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

_s2t = OpenCC("s2t")


def parse_detail_page(html: str) -> dict[str, Any]:
    """Parse an Hpoi detail page and extract ALL structured fields."""
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, Any] = {}

    for item in soup.select(".hpoi-infoList-item"):
        text = item.get_text(strip=True)

        if text.startswith("名称"):
            result["japanese_name"] = text[2:].strip()

        elif text.startswith("属性"):
            # "女、比例人形、全年龄" → parse into gender, type, age_rating
            attrs = text[2:].strip()
            result["attributes_raw"] = attrs
            parts = [p.strip() for p in attrs.split("、")]
            for p in parts:
                if p in ("男", "女", "无性别"):
                    result["gender"] = _s2t.convert(p)
                elif p in ("全年龄", "R18", "R15"):
                    result["age_rating"] = p
                elif "人形" in p or "手办" in p or "雕像" in p:
                    result["figure_type"] = _s2t.convert(p)

        elif text.startswith("定价"):
            # Match JPY price
            price_match = re.search(r"([\d,]+)\s*日元", text)
            if price_match:
                result["price_jpy"] = int(price_match.group(1).replace(",", ""))
            else:
                # Match CNY/RMB price and convert to JPY
                cny_match = re.search(r"([\d,]+)\s*(?:人民币|元)", text)
                if cny_match:
                    cny = int(cny_match.group(1).replace(",", ""))
                    result["price_jpy"] = round(cny * 149.5 / 7.25)  # CNY -> JPY
                    result["price_cny"] = cny

        elif text.startswith("发售"):
            # Extract all release dates: "2021/7/28 , 15800日元2019/7/23..."
            dates = re.findall(r"(\d{4}/\d{1,2}/\d{1,2})", text)
            if dates:
                result["release_date"] = dates[0]  # First/latest release
                if len(dates) > 1:
                    result["reissue_dates"] = ", ".join(dates[1:])  # Reissues

        elif text.startswith("比例"):
            scale_match = re.search(r"(1/\d+)", text)
            if scale_match:
                result["scale"] = scale_match.group(1)

        elif text.startswith("制作"):
            result["manufacturer"] = text[2:].strip()

        elif text.startswith("原型"):
            result["sculptor"] = text[2:].strip()

        elif text.startswith("涂装"):
            result["painter"] = _s2t.convert(text[2:].strip())

        elif text.startswith("角色"):
            result["character"] = text[2:].strip()

        elif text.startswith("作品"):
            result["franchise"] = text[2:].strip()

        elif text.startswith("尺寸"):
            result["dimensions"] = text[2:].strip()

        elif text.startswith("材质"):
            result["material"] = _s2t.convert(text[2:].strip())

    # Extract cover image
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if "rfx.hpoi.net/gk/cover" in src:
            result["image_url"] = src.split("?")[0]
            break

    # Convert text fields to Traditional Chinese
    for key in ("character", "franchise", "japanese_name"):
        if key in result and result[key]:
            result[key] = _s2t.convert(result[key])

    return result


class HpoiDetailScraper:
    """Fetches detail pages from Hpoi to get full structured data."""

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

    async def fetch_detail(self, hpoi_id: int) -> dict[str, Any] | None:
        """Fetch and parse a single detail page."""
        client = await self._get_client()
        self._request_count += 1

        if self._request_count % 100 == 0:
            logger.info("Rate limit pause at request %d", self._request_count)
            await asyncio.sleep(random.uniform(2.0, 4.0))

        url = f"{BASE_URL}/hobby/{hpoi_id}"
        for attempt in range(3):
            try:
                resp = await client.get(url)
                if resp.status_code == 429:
                    wait = 15 * (attempt + 1)
                    logger.warning("Rate limited on %d, waiting %ds", hpoi_id, wait)
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code == 403:
                    logger.warning("Blocked on %d, waiting 60s", hpoi_id)
                    await asyncio.sleep(30)
                    continue
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()

                data = parse_detail_page(resp.text)
                data["hpoi_id"] = hpoi_id
                return data

            except httpx.HTTPStatusError:
                await asyncio.sleep(5)
            except httpx.RequestError as e:
                logger.warning("Request error for %d: %s", hpoi_id, e)
                await asyncio.sleep(5)

        return None
