#!/usr/bin/env python3
"""
Standalone Hpoi enricher — runs on any machine, scrapes ALL figures at once.

Usage:
    # 1. Copy figures_to_enrich.csv from server (or this script generates it)
    # 2. Run:
    python3 standalone_hpoi_enricher.py --csv figures_to_enrich.csv --output enriched_results.json

    # 3. Copy results back to server and import:
    scp enriched_results.json <USER>@<SERVER_IP>:/home/pinhao/figurein/tools/ -P 8022
    # Then on server:
    # docker compose exec -T scraper python3 /tmp/import_enrichment.py /tmp/enriched_results.json

    # Or import directly if you have DB access:
    python3 standalone_hpoi_enricher.py --csv figures_to_enrich.csv --direct --db-url postgresql://figureout:${POSTGRES_PASSWORD}@<SERVER_IP>:5432/figureout

Requirements:
    pip install httpx beautifulsoup4 opencc-python-reimplemented
"""

import argparse
import asyncio
import csv
import json
import logging
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    print("Missing httpx. Run: pip install httpx")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Missing beautifulsoup4. Run: pip install beautifulsoup4")
    sys.exit(1)

try:
    from opencc import OpenCC
    _s2t = OpenCC("s2t")
except ImportError:
    print("Missing opencc. Run: pip install opencc-python-reimplemented")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("hpoi_enricher")

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


def parse_detail_page(html: str) -> dict[str, Any]:
    """Parse an Hpoi detail page and extract ALL structured fields."""
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, Any] = {}

    for item in soup.select(".hpoi-infoList-item"):
        text = item.get_text(strip=True)

        if text.startswith("名称"):
            result["japanese_name"] = text[2:].strip()
        elif text.startswith("属性"):
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
            price_match = re.search(r"([\d,]+)\s*日元", text)
            if price_match:
                result["price_jpy"] = int(price_match.group(1).replace(",", ""))
        elif text.startswith("发售"):
            dates = re.findall(r"(\d{4}/\d{1,2}/\d{1,2})", text)
            if dates:
                result["release_date"] = dates[0]
                if len(dates) > 1:
                    result["reissue_dates"] = ", ".join(dates[1:])
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


async def fetch_one(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    fig_id: int,
    hpoi_id: int,
    results: dict,
    stats: dict,
):
    async with sem:
        url = f"{BASE_URL}/hobby/{hpoi_id}"
        for attempt in range(3):
            try:
                resp = await client.get(url)
                if resp.status_code == 429:
                    wait = 20 * (attempt + 1)
                    logger.warning("Rate limited on %d, waiting %ds", hpoi_id, wait)
                    stats["rate_limits"] += 1
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code == 403:
                    logger.warning("Blocked on %d, waiting 30s", hpoi_id)
                    stats["blocks"] += 1
                    await asyncio.sleep(30)
                    continue
                if resp.status_code == 404:
                    stats["not_found"] += 1
                    return
                resp.raise_for_status()

                data = parse_detail_page(resp.text)
                if data:
                    data["hpoi_id"] = hpoi_id
                    data["figure_id"] = fig_id
                    results[fig_id] = data
                    stats["success"] += 1
                else:
                    stats["empty"] += 1

                # Small random delay
                await asyncio.sleep(random.uniform(0.2, 0.5))
                return

            except httpx.HTTPStatusError as e:
                logger.warning("HTTP error for %d: %s", hpoi_id, e)
                await asyncio.sleep(5)
            except httpx.RequestError as e:
                logger.warning("Request error for %d: %s", hpoi_id, e)
                await asyncio.sleep(5)

        stats["errors"] += 1


async def run_scraper(figures: list[tuple[int, int]], concurrency: int = 10):
    """Scrape all figures concurrently."""
    results: dict[int, dict] = {}
    stats = {
        "success": 0,
        "errors": 0,
        "not_found": 0,
        "empty": 0,
        "rate_limits": 0,
        "blocks": 0,
    }
    sem = asyncio.Semaphore(concurrency)
    total = len(figures)

    logger.info("Starting enrichment of %d figures with concurrency=%d", total, concurrency)

    async with httpx.AsyncClient(
        headers=HEADERS, timeout=30.0, follow_redirects=True
    ) as client:
        tasks = []
        for fig_id, hpoi_id in figures:
            tasks.append(fetch_one(client, sem, fig_id, hpoi_id, results, stats))

        # Process in batches of 200 for progress reporting
        batch_size = 200
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i : i + batch_size]
            await asyncio.gather(*batch)
            done = min(i + batch_size, total)
            logger.info(
                "Progress: %d/%d (%.1f%%) — success=%d, errors=%d, 404=%d, rate_limits=%d",
                done, total, done / total * 100,
                stats["success"], stats["errors"], stats["not_found"], stats["rate_limits"],
            )

            # If getting rate limited a lot, back off
            if stats["rate_limits"] > 5:
                logger.warning("Many rate limits, pausing 30s...")
                await asyncio.sleep(30)
                stats["rate_limits"] = 0

    logger.info(
        "Done! success=%d, errors=%d, not_found=%d, empty=%d, rate_limits=%d, blocks=%d",
        stats["success"], stats["errors"], stats["not_found"], stats["empty"],
        stats["rate_limits"], stats["blocks"],
    )
    return results


def main():
    parser = argparse.ArgumentParser(description="Standalone Hpoi figure enricher")
    parser.add_argument("--csv", required=True, help="CSV file with id,source_id columns")
    parser.add_argument("--output", default="enriched_results.json", help="Output JSON file")
    parser.add_argument("--concurrency", type=int, default=10, help="Concurrent requests (default: 10)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of figures (0=all)")
    args = parser.parse_args()

    # Read CSV
    figures = []
    with open(args.csv, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            fig_id = int(row["id"])
            source_id = int(row["source_id"])
            figures.append((fig_id, source_id))

    if args.limit > 0:
        figures = figures[: args.limit]

    logger.info("Loaded %d figures to enrich", len(figures))

    start = time.time()
    results = asyncio.run(run_scraper(figures, concurrency=args.concurrency))
    elapsed = time.time() - start

    # Save results
    output_path = Path(args.output)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    logger.info(
        "Saved %d enriched results to %s (%.1f minutes)",
        len(results), output_path, elapsed / 60,
    )


if __name__ == "__main__":
    main()
