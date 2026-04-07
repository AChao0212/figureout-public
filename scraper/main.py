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

_s2t = OpenCC("s2t")  # Simplified -> Traditional Chinese

# Cheap figure types to exclude
CHEAP_PATTERNS = re.compile(
    r"(粘土人|黏土人|nendoroid|figma|景品|一番赏|一番獎|扭蛋|盲盒|trading|食玩|迷你)",
    re.IGNORECASE,
)



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
        # Get enriched figures with Japanese names, ordered by least listings
        figures = session.query(Figure).filter(
            Figure.image_url.isnot(None),
            Figure.original_name.isnot(None),
            Figure.retail_price.isnot(None),
        ).order_by(Figure.view_count.desc().nullslast(), Figure.id).limit(batch_size).all()

        if not figures:
            logger.info("No figures to price-check on Mercari")
            return {"processed": 0, "matched": 0, "listings": 0}

        logger.info("Mercari price-check: %d figures", len(figures))

        async def _fetch():
            nonlocal matched, listings_created, errors, processed
            scraper = MercariScraper()
            try:
                for fig in figures:
                    processed += 1
                    # Use Japanese name for Mercari search
                    query = fig.original_name
                    # Trim to core name (remove long subtitles)
                    if len(query) > 50:
                        query = query[:50]

                    try:
                        results = await scraper.search_sold(query, limit=20)
                        if not results:
                            await _asyncio.sleep(_random.uniform(3.0, 6.0))
                            continue

                        matched += 1
                        for r in results[:5]:  # Top 5 per figure
                            # Skip if already exists
                            if r["source_id"]:
                                existing = session.query(Listing).filter(
                                    Listing.source == "mercari",
                                    Listing.source_id == r["source_id"],
                                ).first()
                                if existing:
                                    continue

                            # Basic price sanity check against retail
                            if fig.retail_price and r["price_jpy"] > 0:
                                ratio = r["price_jpy"] / fig.retail_price
                                if ratio > 5.0 or ratio < 0.05:
                                    continue  # Likely wrong match

                            # Filter out non-figure items & flag for review
                            if not is_valid_figure_listing(r["title"]):
                                is_valid, reason = validate_listing(r["title"])
                                if not is_valid:
                                    report = ErrorReport(
                                        figure_id=fig.id,
                                        report_type="suspicious_listing",
                                        description=(
                                            f"[Mercari] 疑似非公仔商品: {reason}"
                                            f"\nTitle: {r['title']}"
                                            f"\nURL: {r.get('url', 'N/A')}"
                                        ),
                                        status="pending",
                                    )
                                    session.add(report)
                                    logger.info("Flagged suspicious Mercari listing: %s", r["title"][:50])
                                continue

                            # Filter out wrong figure types
                            if not listing_matches_figure_type(r["title"], fig.figure_type, fig.scale):
                                continue

                            listing = Listing(
                                figure_id=fig.id,
                                source="mercari",
                                source_id=r["source_id"],
                                title=r["title"],
                                price=r["price_jpy"],
                                currency="JPY",
                                price_usd=round(r["price_jpy"] / 149.5, 2),
                                condition=r.get("condition", "used"),
                                is_sold=True,
                                url=r["url"],
                                image_url=r.get("image_url"),
                            )
                            session.add(listing)
                            listings_created += 1
                    except Exception:
                        errors += 1
                        if errors <= 5:
                            logger.exception("Mercari search failed: %s", fig.original_name[:30] if fig.original_name else "?")

                    await _asyncio.sleep(_random.uniform(4.0, 8.0))
            finally:
                await scraper.close()

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
        # Prioritize figures that have no listings yet, then by popularity
        from sqlalchemy import exists
        has_listing = exists().where(Listing.figure_id == Figure.id)
        figures = session.query(Figure).filter(
            Figure.image_url.isnot(None),
            Figure.original_name.isnot(None),
            Figure.retail_price.isnot(None),
        ).order_by(
            has_listing.asc(),  # Figures without listings first
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
                        for r in results[:5]:
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
                                    report = ErrorReport(
                                        figure_id=fig.id,
                                        report_type="suspicious_listing",
                                        description=(
                                            f"[Yahoo] 疑似非公仔商品: {reason}"
                                            f"\nTitle: {r['title']}"
                                            f"\nURL: {r.get('url', 'N/A')}"
                                        ),
                                        status="pending",
                                    )
                                    session.add(report)
                                    logger.info("Flagged suspicious Yahoo listing: %s", r["title"][:50])
                                continue

                            # Filter out wrong figure types (e.g. Nendoroid in scale figure results)
                            if not listing_matches_figure_type(r["title"], fig.figure_type, fig.scale):
                                continue

                            try:
                                listing = Listing(
                                    figure_id=fig.id,
                                    source="yahoo_auction",
                                    source_id=r["source_id"],
                                    title=r["title"],
                                    price=r["price_jpy"],
                                    currency="JPY",
                                    price_usd=round(r["price_jpy"] / 149.5, 2),
                                    condition=r.get("condition", "used"),
                                    is_sold=True,
                                    url=r["url"],
                                    image_url=r.get("image_url"),
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
    """
    from statistics import median as _median
    
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
                Listing.price_usd.isnot(None),
                Listing.price_usd > 0,
            ).distinct().all()
        ]
        
        logger.info("Generating snapshots for %d figures with listings", len(figure_ids))
        
        for fig_id in figure_ids:
            try:
                # Use listings whose sold_at is within 30 days of today
                # This ensures the snapshot reflects recent market prices, not old transactions
                window_start = today - timedelta(days=30)
                all_listings = session.query(Listing.price_usd, Listing.condition).filter(
                    Listing.figure_id == fig_id,
                    Listing.price_usd.isnot(None),
                    Listing.price_usd > 0,
                    or_(
                        and_(Listing.sold_at.isnot(None), Listing.sold_at >= window_start),
                        and_(Listing.sold_at.is_(None), Listing.scraped_at >= window_start),
                    ),
                ).all()
                
                # Fallback: if no recent listings, use all listings (for figures with only old data)
                if not all_listings:
                    all_listings = session.query(Listing.price_usd, Listing.condition).filter(
                        Listing.figure_id == fig_id,
                        Listing.price_usd.isnot(None),
                        Listing.price_usd > 0,
                    ).all()
                
                if not all_listings:
                    continue
                
                prices_by_cond = {"all": [], "sealed": [], "opened": [], "used": [], "damaged": []}
                for price_usd, cond in all_listings:
                    prices_by_cond["all"].append(float(price_usd))
                    bucket = cond if cond in ("sealed", "opened", "used", "damaged") else "used"
                    prices_by_cond[bucket].append(float(price_usd))
                
                for cond, prices in prices_by_cond.items():
                    if not prices:
                        continue
                    
                    prices.sort()
                    # Trimmed mean (10% each side) to protect against price manipulation
                    if len(prices) >= 5:
                        trim_count = max(1, len(prices) // 10)
                        trimmed = prices[trim_count:-trim_count]
                        avg_p = round(sum(trimmed) / len(trimmed), 2)
                    else:
                        avg_p = round(sum(prices) / len(prices), 2)
                    med_p = round(_median(prices), 2)
                    min_p = round(min(prices), 2)
                    max_p = round(max(prices), 2)
                    
                    existing = session.query(PriceSnapshot).filter(
                        PriceSnapshot.figure_id == fig_id,
                        PriceSnapshot.date == today,
                        PriceSnapshot.condition == cond,
                    ).first()
                    
                    if existing:
                        existing.avg_price = avg_p
                        existing.median_price = med_p
                        existing.min_price = min_p
                        existing.max_price = max_p
                        existing.sample_count = len(prices)
                        updated += 1
                    else:
                        snap = PriceSnapshot(
                            figure_id=fig_id,
                            date=today,
                            avg_price=avg_p,
                            median_price=med_p,
                            min_price=min_p,
                            max_price=max_p,
                            sample_count=len(prices),
                            condition=cond,
                        )
                        session.add(snap)
                        created += 1
                
                # Update figure current prices from all condition
                all_prices = prices_by_cond["all"]
                if all_prices:
                    fig = session.query(Figure).filter(Figure.id == fig_id).first()
                    if fig:
                        # Trimmed mean for figure current price (all_prices already sorted)
                        if len(all_prices) >= 5:
                            _tc = max(1, len(all_prices) // 10)
                            _trimmed = all_prices[_tc:-_tc]
                            fig.avg_price = round(sum(_trimmed) / len(_trimmed), 2)
                        else:
                            fig.avg_price = round(sum(all_prices) / len(all_prices), 2)
                        fig.median_price = round(_median(all_prices), 2)
                
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
                Listing.price_usd.isnot(None),
                Listing.price_usd > 0,
            ).distinct().all()
        ]

        for fig_id in figure_ids:
            try:
                all_listings = session.query(Listing.price_usd).filter(
                    Listing.figure_id == fig_id,
                    Listing.price_usd.isnot(None),
                    Listing.price_usd > 0,
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

                            # Calculate USD price
                            price_usd = round(r["price"] / 149.5, 2)

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
                                price_usd=price_usd,
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
    # Yahoo scraper disabled
    # "scrape-yahoo-every-24h": {
    #     "task": "scrape_yahoo_prices",
    #     "schedule": 86400,
    #     "kwargs": {"batch_size": 30},
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
    # Rakuma scraper disabled until matching is improved
    # "scrape-rakuma-every-12h": {
    #     "task": "scrape_rakuma_prices",
    #     "schedule": 43200,
    #     "kwargs": {"batch_size": 30},
    # },
}


if __name__ == "__main__":
    app.worker_main(["worker", "--beat", "--loglevel=info", "--concurrency=3"])
