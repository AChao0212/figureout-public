#!/usr/bin/env python3
"""Figurein standalone scraper — runs without Celery/Redis.

Scrapes Yahoo Auctions Japan and Mercari for completed figure sales.
Can write directly to PostgreSQL or export to JSON for later import.

Usage:
    # Direct mode (writes to DB):
    python standalone_scraper.py --mode direct --batch-size 50 --max-figures 200

    # Export mode (saves JSON):
    python standalone_scraper.py --mode export --batch-size 50 --max-figures 200 -o results.json

    # Mercari source:
    python standalone_scraper.py --mode direct --source mercari --batch-size 30
"""

import argparse
import asyncio
import json
import logging
import os
import random
import re
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("standalone_scraper")

# ---------------------------------------------------------------------------
# JPY -> USD conversion rate (approximate)
# ---------------------------------------------------------------------------
JPY_USD_RATE = 149.5

# ---------------------------------------------------------------------------
# Figure type matching (replicated from main.py)
# ---------------------------------------------------------------------------

NENDOROID_KEYWORDS = re.compile(
    r"(ねんどろいど|黏土人|粘土人|nendoroid)", re.IGNORECASE,
)
FIGMA_KEYWORDS = re.compile(
    r"(figma|フィグマ)", re.IGNORECASE,
)
PRIZE_KEYWORDS = re.compile(
    r"(景品|プライズ|一番くじ|一番賞)", re.IGNORECASE,
)
SEALED_KEYWORDS = re.compile(
    r"新品|未開封|未使用|新品未開封|sealed|brand.?new|未開|MISB|新品未使用",
    re.IGNORECASE,
)


def detect_condition(title: str) -> str:
    if SEALED_KEYWORDS.search(title):
        return "sealed"
    return "used"


def listing_matches_figure_type(
    title: str, figure_type: str | None, scale: str | None
) -> bool:
    is_scale_figure = scale and re.match(r"1/\d+", scale)
    is_nendoroid = figure_type and (
        "黏土人" in figure_type or "nendoroid" in figure_type.lower()
    )

    if is_scale_figure and not is_nendoroid:
        if NENDOROID_KEYWORDS.search(title):
            return False
        if FIGMA_KEYWORDS.search(title):
            return False
        if PRIZE_KEYWORDS.search(title):
            return False

    return True


# ---------------------------------------------------------------------------
# Yahoo Auctions scraper (standalone, from yahoo_auction.py)
# ---------------------------------------------------------------------------

class YahooAuctionScraper:
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

    async def search_completed(self, query: str, limit: int = 30) -> list[dict]:
        url = f"{self.BASE}/closedsearch/closedsearch"
        params = {"p": query, "va": query, "n": str(min(limit, 50))}
        try:
            resp = await self.client.get(url, params=params)
            if resp.status_code != 200:
                logger.warning("Yahoo search %d for %s", resp.status_code, query)
                return []
            return self._parse_next_data(resp.text)
        except Exception:
            logger.exception("Yahoo search failed for %s", query)
            return []

    def _parse_next_data(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        script = soup.find("script", id="__NEXT_DATA__")
        if not script or not script.string:
            return self._parse_results_fallback(soup)
        try:
            data = json.loads(script.string)
            items = (
                data.get("props", {})
                .get("pageProps", {})
                .get("initialState", {})
                .get("search", {})
                .get("items", {})
                .get("listing", {})
                .get("items", [])
            )
            results = []
            for item in items:
                try:
                    auction_id = item.get("auctionId", "")
                    title = item.get("title", "")
                    if not title or not auction_id:
                        continue
                    price_jpy = (
                        item.get("currentPrice")
                        or item.get("price")
                        or item.get("buyNowPrice", 0)
                    )
                    if not price_jpy or price_jpy <= 0:
                        continue
                    results.append({
                        "title": title,
                        "price_jpy": int(price_jpy),
                        "url": f"{self.BASE}/jp/auction/{auction_id}",
                        "image_url": item.get("image", "") or item.get("imageUrl", ""),
                        "source_id": auction_id,
                        "condition": detect_condition(title),
                        "is_sold": True,
                        "bids": item.get("bidCount", 0),
                    })
                except Exception:
                    continue
            return results
        except (json.JSONDecodeError, KeyError):
            return []

    def _parse_results_fallback(self, soup: BeautifulSoup) -> list[dict]:
        results = []
        for item in soup.select(".Product"):
            try:
                title_el = item.select_one(".Product__titleLink") or item.select_one(
                    "a.Product__imageLink"
                )
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                url = title_el.get("href", "")
                source_id = ""
                id_match = re.search(r"/([a-z]\d+)", url)
                if id_match:
                    source_id = id_match.group(1)
                price_el = item.select_one(".Product__priceValue") or item.select_one(
                    ".Product__price"
                )
                if not price_el:
                    continue
                price_text = price_el.get_text(strip=True)
                price_match = re.search(r"([\d,]+)", price_text)
                if not price_match:
                    continue
                price_jpy = int(price_match.group(1).replace(",", ""))
                img_el = item.select_one("img")
                img_url = img_el.get("src", "") if img_el else ""
                bids = 0
                bids_el = item.select_one(".Product__bid")
                if bids_el:
                    bids_match = re.search(r"(\d+)", bids_el.get_text())
                    if bids_match:
                        bids = int(bids_match.group(1))
                results.append({
                    "title": title,
                    "price_jpy": price_jpy,
                    "url": url,
                    "image_url": img_url,
                    "source_id": source_id,
                    "condition": detect_condition(title),
                    "is_sold": True,
                    "bids": bids,
                })
            except Exception:
                continue
        return results


# ---------------------------------------------------------------------------
# Mercari scraper (standalone, from mercari.py)
# ---------------------------------------------------------------------------

class MercariScraper:
    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json, text/plain, */*",
                "X-Platform": "web",
            },
        )

    async def close(self):
        await self.client.aclose()

    async def search_sold(self, query: str, limit: int = 30) -> list[dict]:
        url = "https://jp.mercari.com/search"
        params = {
            "keyword": query,
            "status": "sold_out",
            "category_id": "1328",
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

    def _parse_search_html(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        results = []
        for item in soup.select('[data-testid="item-cell"]'):
            try:
                title_el = item.select_one('[data-testid="thumbnail-link"]') or item.select_one("a")
                if not title_el:
                    continue
                href = title_el.get("href", "")
                item_id = ""
                id_match = re.search(r"/item/(\w+)", href)
                if id_match:
                    item_id = id_match.group(1)
                item_url = f"https://jp.mercari.com/item/{item_id}" if item_id else ""
                name_el = item.select_one("img")
                title = name_el.get("alt", "") if name_el else ""
                price_el = item.select_one('[class*="Price"]') or item.select_one('[class*="price"]')
                if not price_el:
                    text = item.get_text()
                    price_match = re.search(r"[¥￥]\s*([\d,]+)", text)
                    if price_match:
                        price_jpy = int(price_match.group(1).replace(",", ""))
                    else:
                        continue
                else:
                    price_text = price_el.get_text(strip=True)
                    price_match = re.search(r"([\d,]+)", price_text)
                    if not price_match:
                        continue
                    price_jpy = int(price_match.group(1).replace(",", ""))
                img_url = name_el.get("src", "") if name_el else ""
                results.append({
                    "title": title,
                    "price_jpy": price_jpy,
                    "url": item_url,
                    "image_url": img_url,
                    "source_id": item_id,
                    "condition": "used",
                    "is_sold": True,
                })
            except Exception:
                continue
        # Fallback: JSON in script tags
        if not results:
            for script in soup.select('script[type="application/json"]'):
                try:
                    data = json.loads(script.string or "")
                    if isinstance(data, dict):
                        results.extend(self._extract_items_from_json(data))
                except Exception:
                    continue
        return results

    def _extract_items_from_json(self, data: dict, depth: int = 0) -> list[dict]:
        if depth > 5:
            return []
        results = []
        if "id" in data and "price" in data and "name" in data:
            try:
                results.append({
                    "title": str(data.get("name", "")),
                    "price_jpy": int(data.get("price", 0)),
                    "url": f"https://jp.mercari.com/item/{data['id']}",
                    "image_url": "",
                    "source_id": str(data["id"]),
                    "condition": "used",
                    "is_sold": True,
                })
            except (ValueError, TypeError):
                pass
        for val in data.values():
            if isinstance(val, dict):
                results.extend(self._extract_items_from_json(val, depth + 1))
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        results.extend(self._extract_items_from_json(item, depth + 1))
        return results


# ---------------------------------------------------------------------------
# DB helpers (for direct mode)
# ---------------------------------------------------------------------------

def get_db_session(database_url: str):
    """Create a SQLAlchemy session from a database URL."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return Session()


def load_figures_from_db(session, max_figures: int, source: str) -> list[dict]:
    """Load figures that need price scraping from the DB."""
    from sqlalchemy import Column, Integer, Text, Numeric, Boolean, ForeignKey, exists
    from sqlalchemy.orm import declarative_base
    from sqlalchemy.dialects.postgresql import TIMESTAMP
    from sqlalchemy.sql import func

    # Use raw SQL to avoid needing the full models
    result = session.execute(
        """
        SELECT f.id, f.name, f.original_name, f.scale, f.figure_type, f.retail_price,
               f.manufacturer
        FROM figures f
        WHERE f.image_url IS NOT NULL
          AND f.original_name IS NOT NULL
          AND f.retail_price IS NOT NULL
        ORDER BY
            (SELECT COUNT(*) FROM listings l WHERE l.figure_id = f.id) ASC,
            f.view_count DESC NULLS LAST,
            f.id
        LIMIT :limit
        """,
        {"limit": max_figures},
    )
    figures = []
    for row in result:
        figures.append({
            "id": row[0],
            "name": row[1],
            "original_name": row[2],
            "scale": row[3],
            "figure_type": row[4],
            "retail_price": row[5],
            "manufacturer": row[6],
        })
    return figures


def save_listings_to_db(session, listings: list[dict]) -> int:
    """Insert listings into the DB, skipping duplicates. Returns count inserted."""
    inserted = 0
    for lst in listings:
        # Check for existing
        existing = session.execute(
            """
            SELECT id FROM listings
            WHERE source = :source AND source_id = :source_id
            LIMIT 1
            """,
            {"source": lst["source"], "source_id": lst["source_id"]},
        ).fetchone()
        if existing:
            continue

        session.execute(
            """
            INSERT INTO listings (figure_id, source, source_id, title, price, currency,
                                  price_usd, condition, is_sold, url, image_url, scraped_at)
            VALUES (:figure_id, :source, :source_id, :title, :price, :currency,
                    :price_usd, :condition, :is_sold, :url, :image_url, NOW())
            """,
            {
                "figure_id": lst["figure_id"],
                "source": lst["source"],
                "source_id": lst["source_id"],
                "title": lst["title"],
                "price": lst["price_jpy"],
                "currency": "JPY",
                "price_usd": round(lst["price_jpy"] / JPY_USD_RATE, 2),
                "condition": lst.get("condition", "used"),
                "is_sold": True,
                "url": lst.get("url", ""),
                "image_url": lst.get("image_url", ""),
            },
        )
        inserted += 1

    session.commit()
    return inserted


# ---------------------------------------------------------------------------
# Core scrape logic
# ---------------------------------------------------------------------------

async def scrape_figures(
    figures: list[dict],
    source: str,
    concurrency: int = 5,
    batch_size: int = 50,
) -> list[dict]:
    """Scrape auction results for a list of figures. Returns listing dicts."""

    sem = asyncio.Semaphore(concurrency)
    all_listings: list[dict] = []
    matched = 0
    processed = 0
    errors = 0

    if source == "yahoo":
        scraper = YahooAuctionScraper()
        source_name = "yahoo_auction"
    else:
        scraper = MercariScraper()
        source_name = "mercari"

    async def _scrape_one(fig: dict):
        nonlocal matched, processed, errors
        async with sem:
            processed += 1
            query = fig["original_name"] or ""

            if source == "yahoo":
                # Must have Japanese characters for Yahoo
                has_japanese = bool(
                    re.search(r"[\u3040-\u309F\u30A0-\u30FF]", query)
                )
                if not has_japanese and query:
                    return

                if len(query) > 35:
                    query = query[:35].rsplit(" ", 1)[0]

                # Add フィギュア keyword
                if "フィギュア" not in query and "figure" not in query.lower():
                    query = query + " フィギュア"

                # Add scale if available
                if fig.get("scale") and fig["scale"] not in query:
                    query = query + " " + fig["scale"]

                try:
                    results = await scraper.search_completed(query, limit=20)
                except Exception:
                    errors += 1
                    return
            else:
                # Mercari
                if len(query) > 50:
                    query = query[:50]
                try:
                    results = await scraper.search_sold(query, limit=20)
                except Exception:
                    errors += 1
                    return

            if not results:
                await asyncio.sleep(random.uniform(3.0, 6.0))
                return

            matched += 1
            count = 0
            for r in results:
                if count >= 5:
                    break

                # Price floor for Yahoo
                if source == "yahoo" and r["price_jpy"] < 3000:
                    continue

                # Price sanity check
                retail = fig.get("retail_price")
                if retail and r["price_jpy"] > 0:
                    ratio = r["price_jpy"] / float(retail)
                    if ratio > 5.0 or ratio < 0.05:
                        continue

                # Figure type filter
                if not listing_matches_figure_type(
                    r["title"], fig.get("figure_type"), fig.get("scale")
                ):
                    continue

                all_listings.append({
                    "figure_id": fig["id"],
                    "figure_name": fig["name"],
                    "source": source_name,
                    "source_id": r["source_id"],
                    "title": r["title"],
                    "price_jpy": r["price_jpy"],
                    "price_usd": round(r["price_jpy"] / JPY_USD_RATE, 2),
                    "condition": r.get("condition", "used"),
                    "is_sold": True,
                    "url": r.get("url", ""),
                    "image_url": r.get("image_url", ""),
                    "bids": r.get("bids", 0),
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                })
                count += 1

            # Rate limiting
            await asyncio.sleep(random.uniform(4.0, 8.0))

    # Process in batches
    for i in range(0, len(figures), batch_size):
        batch = figures[i : i + batch_size]
        logger.info(
            "Processing batch %d-%d / %d",
            i + 1,
            min(i + batch_size, len(figures)),
            len(figures),
        )
        tasks = [_scrape_one(fig) for fig in batch]
        await asyncio.gather(*tasks)
        logger.info(
            "Batch done. Processed: %d, Matched: %d, Listings: %d, Errors: %d",
            processed, matched, len(all_listings), errors,
        )

    await scraper.close()
    logger.info(
        "Scraping complete. Processed: %d, Matched: %d, Total listings: %d, Errors: %d",
        processed, matched, len(all_listings), errors,
    )
    return all_listings


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Figurein standalone scraper for Yahoo Auctions / Mercari"
    )
    parser.add_argument(
        "--mode",
        choices=["direct", "export"],
        default="export",
        help="direct = write to DB; export = save JSON file (default: export)",
    )
    parser.add_argument(
        "--source",
        choices=["yahoo", "mercari", "both"],
        default="yahoo",
        help="Which source to scrape (default: yahoo)",
    )
    parser.add_argument("--batch-size", type=int, default=50, help="Figures per batch")
    parser.add_argument("--max-figures", type=int, default=200, help="Max figures to scrape")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent requests")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="PostgreSQL connection URL (or set DATABASE_URL env var)",
    )
    parser.add_argument("-o", "--output", default="results.json", help="Output JSON file")
    parser.add_argument(
        "--figures-json",
        help="Path to a JSON file with figure data (skip DB fetch). "
             "Format: [{id, name, original_name, scale, figure_type, retail_price}, ...]",
    )
    args = parser.parse_args()

    # Load figures
    if args.figures_json:
        logger.info("Loading figures from %s", args.figures_json)
        with open(args.figures_json) as f:
            figures = json.load(f)
        logger.info("Loaded %d figures from JSON", len(figures))
    elif args.database_url:
        logger.info("Loading figures from database...")
        from sqlalchemy import text
        session = get_db_session(args.database_url)
        # Use text() for raw SQL
        result = session.execute(
            text("""
                SELECT f.id, f.name, f.original_name, f.scale, f.figure_type, f.retail_price,
                       f.manufacturer
                FROM figures f
                WHERE f.image_url IS NOT NULL
                  AND f.original_name IS NOT NULL
                  AND f.retail_price IS NOT NULL
                ORDER BY
                    (SELECT COUNT(*) FROM listings l WHERE l.figure_id = f.id) ASC,
                    f.view_count DESC NULLS LAST,
                    f.id
                LIMIT :limit
            """),
            {"limit": args.max_figures},
        )
        figures = []
        for row in result:
            figures.append({
                "id": row[0],
                "name": row[1],
                "original_name": row[2],
                "scale": row[3],
                "figure_type": row[4],
                "retail_price": float(row[5]) if row[5] else None,
                "manufacturer": row[6],
            })
        session.close()
        logger.info("Loaded %d figures from DB", len(figures))
    else:
        logger.error("No figure source. Provide --database-url or --figures-json")
        sys.exit(1)

    if not figures:
        logger.warning("No figures to scrape")
        sys.exit(0)

    # Scrape
    sources = [args.source] if args.source != "both" else ["yahoo", "mercari"]
    all_listings = []

    for src in sources:
        logger.info("=== Scraping %s ===", src)
        listings = asyncio.run(
            scrape_figures(
                figures,
                source=src,
                concurrency=args.concurrency,
                batch_size=args.batch_size,
            )
        )
        all_listings.extend(listings)

    logger.info("Total listings scraped: %d", len(all_listings))

    # Output
    if args.mode == "export":
        output_path = args.output
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                    "source": args.source,
                    "total_figures": len(figures),
                    "total_listings": len(all_listings),
                    "listings": all_listings,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        logger.info("Exported %d listings to %s", len(all_listings), output_path)

    elif args.mode == "direct":
        if not args.database_url:
            logger.error("--database-url required for direct mode")
            sys.exit(1)
        from sqlalchemy import text
        session = get_db_session(args.database_url)
        inserted = 0
        skipped = 0
        for lst in all_listings:
            existing = session.execute(
                text("SELECT id FROM listings WHERE source = :source AND source_id = :source_id LIMIT 1"),
                {"source": lst["source"], "source_id": lst["source_id"]},
            ).fetchone()
            if existing:
                skipped += 1
                continue
            session.execute(
                text("""
                    INSERT INTO listings
                        (figure_id, source, source_id, title, price, currency,
                         price_usd, condition, is_sold, url, image_url, scraped_at)
                    VALUES
                        (:figure_id, :source, :source_id, :title, :price, :currency,
                         :price_usd, :condition, :is_sold, :url, :image_url, NOW())
                """),
                {
                    "figure_id": lst["figure_id"],
                    "source": lst["source"],
                    "source_id": lst["source_id"],
                    "title": lst["title"],
                    "price": lst["price_jpy"],
                    "currency": "JPY",
                    "price_usd": lst["price_usd"],
                    "condition": lst.get("condition", "used"),
                    "is_sold": True,
                    "url": lst.get("url", ""),
                    "image_url": lst.get("image_url", ""),
                },
            )
            inserted += 1

        session.commit()
        session.close()
        logger.info("Direct mode: %d inserted, %d skipped (duplicates)", inserted, skipped)

    logger.info("Done.")


if __name__ == "__main__":
    main()
