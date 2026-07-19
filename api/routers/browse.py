from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Float, cast, func, select, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.database import get_db
from db.models import Character, Figure, Franchise, Listing, PriceSnapshot
from schemas import CharacterOut, FigureOut, FranchiseOut

router = APIRouter(prefix="/browse", tags=["browse"])


@router.get("/franchises", response_model=list[FranchiseOut])
async def list_franchises(
    q: str = Query("", description="Search franchise name"),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> list[FranchiseOut]:
    query = select(Franchise)
    if q:
        pattern = f"%{q}%"
        query = query.where(
            or_(
                Franchise.name.ilike(pattern),
                Franchise.name_zh.ilike(pattern),
            )
        )
    query = query.order_by(Franchise.name).limit(limit)
    result = await db.execute(query)
    franchises = result.scalars().all()
    return [FranchiseOut.model_validate(f) for f in franchises]


@router.get("/franchises/{franchise_id}/characters", response_model=list[CharacterOut])
async def list_characters_for_franchise(
    franchise_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[CharacterOut]:
    result = await db.execute(select(Franchise).where(Franchise.id == franchise_id))
    franchise = result.scalar_one_or_none()
    if not franchise:
        raise HTTPException(status_code=404, detail="Franchise not found")

    result = await db.execute(
        select(Character)
        .where(Character.franchise_id == franchise_id)
        .options(selectinload(Character.franchise))
        .order_by(Character.name)
    )
    characters = result.scalars().all()
    return [CharacterOut.model_validate(c) for c in characters]


# Retail-in-canonical helper — delegates to the centralized currency module.
# Returns the TWD value used by snapshot ranking and trending SQL. Synchronous
# (uses fallback rates) so callers in raw-SQL fallback paths don't need `await`.
from currency import retail_to_display as _retail_to_display


def _retail_to_canonical(price, currency="JPY"):
    return _retail_to_display(price, currency or "JPY", "TWD", {})


# Currency-aware price threshold: ~1000 TWD equivalent
# JPY >= 4500, CNY >= 230, USD >= 30, TWD >= 1000
from sqlalchemy import case as sql_case, and_

def _price_above_threshold():
    """Returns a SQL expression: retail_price above ~1000 TWD based on currency."""
    return or_(
        Figure.retail_price.is_(None),
        and_(
            Figure.retail_currency.in_(["JPY", None]),
            Figure.retail_price > 3700,
        ),
        and_(
            Figure.retail_currency == "CNY",
            Figure.retail_price > 180,
        ),
        and_(
            Figure.retail_currency == "USD",
            Figure.retail_price > 25,
        ),
        and_(
            Figure.retail_currency == "TWD",
            Figure.retail_price > 800,
        ),
    )


@router.get("/featured", response_model=list[FigureOut])
async def get_featured_figures(
    limit: int = Query(12, ge=1, le=30),
    currency: str = Query("TWD", description="Display currency for returned prices"),
    db: AsyncSession = Depends(get_db),
) -> list[FigureOut]:
    """Return hot figures — sorted by views, with price change indicators."""
    from currency import (
        get_live_rates as _get_live_rates,
        normalize_currency as _normalize_currency,
        to_display as _to_display,
        retail_to_display as _retail_to_display,
        aggregate_prices as _aggregate_prices,
    )

    display_currency = _normalize_currency(currency, default="TWD")
    # Always fetch live rates: even when display is TWD, we still need the rates
    # to convert non-TWD listings/retail prices accurately (Redis-cached, ~1ms).
    rates = await _get_live_rates()

    def _conv(twd_value):
        """Convert a canonical TWD value to the request's display currency."""
        if twd_value is None:
            return None
        if display_currency == "TWD":
            return float(twd_value)
        return _to_display(twd_value, "TWD", display_currency, rates)
    # Subquery: latest snapshot per figure
    latest_date_sq = (
        select(
            PriceSnapshot.figure_id,
            func.max(PriceSnapshot.date).label("max_date"),
        )
        .where(PriceSnapshot.condition == "all")
        .group_by(PriceSnapshot.figure_id)
        .subquery()
    )
    latest_snap = (
        select(
            PriceSnapshot.figure_id,
            PriceSnapshot.avg_price,
            PriceSnapshot.median_price,
        )
        .where(PriceSnapshot.condition == "all")
        .join(
            latest_date_sq,
            (PriceSnapshot.figure_id == latest_date_sq.c.figure_id)
            & (PriceSnapshot.date == latest_date_sq.c.max_date),
        )
        .subquery()
    )

    result = await db.execute(
        select(
            Figure,
            func.coalesce(Character.name_zh, Character.name).label("char_name"),
            Franchise.name.label("fran_name"),
            latest_snap.c.avg_price.label("current_avg"),
            latest_snap.c.median_price.label("current_median"),
        )
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Figure.franchise_id == Franchise.id)
        .outerjoin(latest_snap, Figure.id == latest_snap.c.figure_id)
        .where(Figure.image_url.isnot(None), _price_above_threshold(), Figure.figure_type != 'Q版人形')
        .order_by(
            # Use recent views (7 days) for fresher ranking
            text("(SELECT COUNT(*) FROM page_views WHERE figure_id = figures.id AND viewed_at >= NOW() - INTERVAL '7 days') DESC, figures.id DESC"),
        )
        .limit(limit)
    )
    rows = result.all()
    figures = []
    for row in rows:
        figure = row[0]
        current_avg = _conv(row[3])
        current_median = _conv(row[4])

        # price_change_pct vs retail — both sides in display currency.
        # `_retail_to_display` falls back internally when rates is empty (TWD same-currency).
        price_change_pct = None
        if current_median is not None and figure.retail_price:
            retail_d = _retail_to_display(
                figure.retail_price, getattr(figure, "retail_currency", "JPY"),
                display_currency, rates or {},
            )
            if retail_d and retail_d > 0:
                price_change_pct = round((current_median - retail_d) / retail_d * 100, 1)

        figures.append(FigureOut(
            id=figure.id,
            name=figure.name,
            series=figure.series,
            manufacturer=figure.manufacturer,
            scale=figure.scale,
            release_year=figure.release_year,
            image_url=figure.image_url,
            version_name=figure.version_name,
            original_name=figure.original_name,
            retail_price=figure.retail_price,
            retail_currency=figure.retail_currency or "JPY",
            character_name=row[1],
            franchise_name=row[2],
            current_avg_price=current_avg,
            current_median_price=current_median,
            price_change_pct=price_change_pct,
        ))

    # Fallback: for figures without snapshots, compute from raw listings in display currency.
    no_price_ids = [f.id for f in figures if f.current_avg_price is None and f.current_median_price is None]
    if no_price_ids:
        from db.models import Listing
        for fid in no_price_ids:
            listing_result = await db.execute(
                select(Listing.price, Listing.currency).where(
                    Listing.figure_id == fid,
                    Listing.price.isnot(None),
                    Listing.price > 0,
                )
            )
            converted = [
                v for (p, c) in listing_result.all()
                if (v := _to_display(p, c, display_currency, rates)) is not None and v > 0
            ]
            if not converted:
                continue
            agg = _aggregate_prices(converted, trim_pct=10)
            for fig in figures:
                if fig.id == fid:
                    fig.current_avg_price = agg["avg"]
                    fig.current_median_price = agg["median"]
                    if fig.retail_price:
                        retail_d = _retail_to_display(
                            fig.retail_price, getattr(fig, "retail_currency", "JPY"),
                            display_currency, rates or {},
                        )
                        if retail_d and retail_d > 0 and agg["median"] is not None:
                            fig.price_change_pct = round((agg["median"] - retail_d) / retail_d * 100, 1)
                    break

    return figures


@router.get("/popular-franchises", response_model=list[FranchiseOut])
async def get_popular_franchises(
    limit: int = Query(12, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
) -> list[FranchiseOut]:
    """Return franchises ranked by recent views (7 days)."""
    from sqlalchemy import text as sql_text
    result = await db.execute(sql_text("""
        SELECT f.id, f.name
        FROM franchises f
        JOIN characters c ON c.franchise_id = f.id
        JOIN figures fig ON fig.character_id = c.id
        JOIN page_views pv ON pv.figure_id = fig.id AND pv.viewed_at >= NOW() - INTERVAL '7 days'
        WHERE f.id != 7168
        GROUP BY f.id, f.name
        ORDER BY COUNT(pv.id) DESC
        LIMIT :lim
    """), {"lim": limit})
    return [{"id": r[0], "name": r[1]} for r in result.all()]



@router.get("/autocomplete/characters")
async def autocomplete_characters(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return deduplicated character names matching query, with their franchise."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(
            func.coalesce(Character.name_zh, Character.name).label("name"),
            Franchise.name.label("franchise"),
        )
        .join(Franchise, Character.franchise_id == Franchise.id)
        .where(
            or_(
                Character.name.ilike(pattern),
                Character.name_zh.ilike(pattern),
            )
        )
        .order_by(Character.name)
        .limit(50)
    )
    # Deduplicate by character name, keep first franchise
    seen = {}
    for row in result.all():
        if row[0] not in seen:
            seen[row[0]] = row[1]
    items = [{"name": name, "franchise": fran} for name, fran in seen.items()]
    return items[:limit]


@router.get("/autocomplete/franchises")
async def autocomplete_franchises(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return franchise names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Franchise.name)
        .where(
            or_(
                Franchise.name.ilike(pattern),
                Franchise.name_zh.ilike(pattern),
            )
        )
        .order_by(Franchise.name)
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/trending")
async def get_trending_figures(
    period: str = Query("7d", description="Period: 3d, 7d, 30d, 365d"),
    mode: str = Query("best", description="best or worst"),
    limit: int = Query(20, ge=1, le=50),
    currency: str = Query("TWD", description="Display currency for returned prices"),
    db: AsyncSession = Depends(get_db),
):
    """Return figures with biggest price changes based on real market activity.

    Aggregations are done in USD (canonical) for ranking; the final price values
    are converted to `currency` so cards across the site stay consistent.
    """
    from sqlalchemy import text as sql_text
    from currency import (
        get_live_rates as _get_live_rates,
        normalize_currency as _normalize_currency,
        to_display as _to_display,
    )

    days_map = {"3d": 3, "7d": 7, "30d": 30, "365d": 365}
    days = days_map.get(period, 7)
    cutoff = date.today() - timedelta(days=days)
    order_dir = "DESC" if mode == "best" else "ASC"

    display_currency = _normalize_currency(currency, default="TWD")
    # Always fetch live rates: even when display is TWD, we still need the rates
    # to convert non-TWD listings/retail prices accurately (Redis-cached, ~1ms).
    rates = await _get_live_rates()

    def _conv(twd_value):
        """Convert a canonical TWD value to display currency (None-safe)."""
        if twd_value is None:
            return None
        if display_currency == "TWD":
            return float(twd_value)
        return _to_display(twd_value, "TWD", display_currency, rates)

    figures = []
    fallback = False

    # Primary: figures with new listings in period
    # Compare new listing median vs old listing median (= real price movement)
    result = await db.execute(sql_text(f"""
        WITH active_figures AS (
            -- Figures that received new reports/listings recently (by scraped_at)
            SELECT figure_id,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_canonical) as new_median,
                   COUNT(*) as new_count
            FROM listings
            WHERE scraped_at >= :cutoff AND price_canonical > 0
            GROUP BY figure_id
        ),
        old_listings AS (
            -- Pre-existing listings (scraped before period)
            SELECT figure_id,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_canonical) as old_median,
                   COUNT(*) as old_count
            FROM listings
            WHERE scraped_at < :cutoff AND price_canonical > 0
            GROUP BY figure_id
        )
        SELECT f.id, f.name, f.image_url, f.manufacturer, f.scale,
               f.retail_price, COALESCE(f.retail_currency, 'JPY') as retail_currency,
               nl.new_median as current_price,
               ol.old_median as previous_price,
               COALESCE(c.name_zh, c.name) as char_name,
               fr.name as fran_name,
               CASE WHEN ol.old_median > 0
                    THEN ROUND(((nl.new_median - ol.old_median) / ol.old_median * 100)::numeric, 1)
                    ELSE NULL END as change_pct,
               nl.new_count
        FROM active_figures nl
        JOIN figures f ON f.id = nl.figure_id
        JOIN old_listings ol ON f.id = ol.figure_id
        LEFT JOIN characters c ON f.character_id = c.id
        LEFT JOIN franchises fr ON f.franchise_id = fr.id
        ORDER BY change_pct {order_dir} NULLS LAST
        LIMIT :lim
    """), {"cutoff": cutoff, "lim": limit})

    for row in result.all():
        current_p_usd = float(row[7]) if row[7] else None
        retail_price = row[5]
        retail_currency = row[6]
        # vs_retail is a percentage so it doesn't depend on display currency.
        vs_retail = None
        if current_p_usd and retail_price:
            retail_usd = _retail_to_canonical(retail_price, retail_currency)
            if retail_usd > 0:
                vs_retail = round((current_p_usd - retail_usd) / retail_usd * 100, 1)
        figures.append({
            "id": row[0], "name": row[1], "image_url": row[2],
            "manufacturer": row[3], "scale": row[4],
            "retail_price": retail_price, "retail_currency": retail_currency,
            "current_median_price": _conv(current_p_usd),
            "previous_price": _conv(float(row[8]) if row[8] else None),
            "change_pct": float(row[11]) if row[11] is not None else None,
            "vs_retail_pct": vs_retail,
            "character_name": row[9], "franchise_name": row[10],
        })

    # Fallback: if no active figures, show all-time vs_retail ranking.
    # Compute vs_retail in Python via the shared currency module so we don't have
    # to repeat hardcoded rates inside SQL CASE expressions.
    if len(figures) == 0:
        fallback = True
        result = await db.execute(sql_text("""
            WITH latest_snap AS (
                SELECT ps.figure_id, ps.median_price as latest_price
                FROM price_snapshots ps
                JOIN (SELECT figure_id, MAX(date) as max_date FROM price_snapshots WHERE condition = 'all' GROUP BY figure_id) sq
                  ON ps.figure_id = sq.figure_id AND ps.date = sq.max_date
                WHERE ps.condition = 'all'
            )
            SELECT f.id, f.name, f.image_url, f.manufacturer, f.scale,
                   f.retail_price, COALESCE(f.retail_currency, 'JPY') as retail_currency,
                   ls.latest_price,
                   COALESCE(c.name_zh, c.name) as char_name,
                   fr.name as fran_name
            FROM figures f
            JOIN latest_snap ls ON f.id = ls.figure_id
            LEFT JOIN characters c ON f.character_id = c.id
            LEFT JOIN franchises fr ON f.franchise_id = fr.id
            WHERE f.retail_price > 0
            AND ls.latest_price IS NOT NULL
            LIMIT :lim
        """), {"lim": max(limit * 4, 200)})

        rows_py = []
        for row in result.all():
            latest_usd = float(row[7]) if row[7] else None
            retail_usd = _retail_to_canonical(row[5], row[6])  # delegates to currency module
            if not latest_usd or not retail_usd or retail_usd <= 0:
                continue
            vs_retail = round((latest_usd - retail_usd) / retail_usd * 100, 1)
            rows_py.append((row, latest_usd, vs_retail))

        rows_py.sort(key=lambda r: r[2], reverse=(order_dir == "DESC"))
        for row, latest_usd, vs_retail in rows_py[:limit]:
            figures.append({
                "id": row[0], "name": row[1], "image_url": row[2],
                "manufacturer": row[3], "scale": row[4],
                "retail_price": row[5], "retail_currency": row[6],
                "current_median_price": _conv(latest_usd),
                "previous_price": None,
                "change_pct": vs_retail,
                "vs_retail_pct": vs_retail,
                "character_name": row[8], "franchise_name": row[9],
            })

    return {"items": figures, "fallback": fallback}


@router.get("/autocomplete/manufacturers")
async def autocomplete_manufacturers(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct manufacturer names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Figure.manufacturer)
        .where(Figure.manufacturer.isnot(None))
        .where(Figure.manufacturer.ilike(pattern))
        .group_by(Figure.manufacturer)
        .order_by(func.count(Figure.id).desc())
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/autocomplete/series")
async def autocomplete_series(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct series names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Figure.series)
        .where(Figure.series.isnot(None))
        .where(Figure.series.ilike(pattern))
        .group_by(Figure.series)
        .order_by(func.count(Figure.id).desc())
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/autocomplete/sculptors")
async def autocomplete_sculptors(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct sculptor names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Figure.sculptor)
        .where(Figure.sculptor.isnot(None))
        .where(Figure.sculptor.ilike(pattern))
        .group_by(Figure.sculptor)
        .order_by(func.count(Figure.id).desc())
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/autocomplete/painters")
async def autocomplete_painters(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct painter names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Figure.painter)
        .where(Figure.painter.isnot(None))
        .where(Figure.painter.ilike(pattern))
        .group_by(Figure.painter)
        .order_by(func.count(Figure.id).desc())
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/autocomplete/illustrators")
async def autocomplete_illustrators(
    q: str = Query("", min_length=1),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct illustrator names matching query."""
    if not q:
        return []
    pattern = f"%{q}%"
    result = await db.execute(
        select(Figure.illustrator)
        .where(Figure.illustrator.isnot(None))
        .where(Figure.illustrator.ilike(pattern))
        .group_by(Figure.illustrator)
        .order_by(func.count(Figure.id).desc())
        .limit(limit)
    )
    return [{"name": row[0]} for row in result.all()]


@router.get("/stats")
async def get_public_stats(db: AsyncSession = Depends(get_db)):
    """Public stats for homepage dashboard."""
    from db.models import Listing
    from sqlalchemy import text as sql_text
    from datetime import datetime, timezone
    
    figures_count = (await db.execute(select(func.count(Figure.id)))).scalar() or 0
    figures_with_price = (await db.execute(
        select(func.count(func.distinct(PriceSnapshot.figure_id)))
    )).scalar() or 0
    listings_count = (await db.execute(select(func.count(Listing.id)))).scalar() or 0
    
    # Use Taiwan timezone (UTC+8) for "today"
    from datetime import timedelta
    tw_tz = timezone(timedelta(hours=8))
    today_start = datetime.now(tw_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        views_today = (await db.execute(
            sql_text("SELECT COUNT(*) FROM page_views WHERE viewed_at >= :since"),
            {"since": today_start}
        )).scalar() or 0
    except Exception:
        views_today = 0
    
    total_views = (await db.execute(
        sql_text("SELECT COUNT(*) FROM page_views")
    )).scalar() or 0
    
    return {
        "figures": figures_count,
        "figures_with_price": figures_with_price,
        "listings": listings_count,
        "views_today": views_today,
        "total_views": total_views,
    }


@router.get("/config/trending-titles")
async def get_trending_titles(db: AsyncSession = Depends(get_db)):
    """Public endpoint to get trending page titles."""
    from sqlalchemy import text as sql_text
    import json
    import logging
    log = logging.getLogger(__name__)

    DEFAULT_BEST = ["誰是最強飆股？", "公仔界的台積電！", "買到就是賺到？", "漲到飛天的公仔！"]
    DEFAULT_WORST = ["狗莊正在砸盤？", "跳水冠軍出爐！", "韭菜收割現場！", "腰斬的慘烈現場"]

    def _parse(raw, default):
        if not raw:
            return default
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, list) and parsed:
                return parsed
        except Exception as e:
            log.warning("Bad site_config value: %s", e)
        return default

    result = await db.execute(sql_text("SELECT key, value FROM site_config WHERE key IN ('trending_best_titles', 'trending_worst_titles')"))
    config = {row.key: row.value for row in result.all()}
    return {
        "best": _parse(config.get("trending_best_titles"), DEFAULT_BEST),
        "worst": _parse(config.get("trending_worst_titles"), DEFAULT_WORST),
    }


# ---------------------------------------------------------------------------
# Exchange Rates
# ---------------------------------------------------------------------------
@router.get("/exchange-rates")
async def get_exchange_rates():
    """Get live exchange rates (cached 1 hour in Redis).
    Implementation lives in `api/currency.py` so this stays a thin handler."""
    from currency import get_live_rates
    return await get_live_rates()
