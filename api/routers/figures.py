from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
_TW = ZoneInfo("Asia/Taipei")

from fastapi import Request, APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select, case, cast, Float
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.database import get_db
from auth import get_current_user_optional, get_current_user, get_real_ip
from db.models import Character, Figure, Franchise, Listing, PriceSnapshot, UserReport
from schemas import (
    ConditionPriceOut,
    FigureRelated,
    FigureDetail,
    FigureOut,
    FigureCardOut,
    SearchResultCard,
    FigureSubmissionIn,
    FigureSubmissionOut,
    ListingOut,
    PriceReportIn,
    PriceSnapshotOut,
    SearchResult,
)

router = APIRouter(prefix="/figures", tags=["figures"])


def classify_condition(condition: str | None) -> str:
    """Classify listing condition into one of 4 categories."""
    if not condition:
        return "used"
    c = condition.lower()
    if c in ("sealed", "new"):
        return "sealed"
    if c == "opened":
        return "opened"
    if c == "damaged":
        return "damaged"
    if c == "used":
        return "used"
    # Legacy/keyword fallback
    sealed_kw = ["sealed", "new", "全新未拆", "未開封", "新品"]
    for kw in sealed_kw:
        if kw in c:
            return "sealed"
    return "used"


# Currency helpers live in api/currency.py — see that module for full docs.
# Locally aliased to keep call sites short.
from currency import (
    VALID_CURRENCIES as _VALID_CURRENCIES,
    aggregate_prices as _aggregate_prices,
    get_live_rates as _get_live_rates,
    normalize_currency as _normalize_currency,
    retail_to_display as _retail_to_display,
    to_display as _to_display,
)


# Currency-aware price threshold: ~1000 TWD equivalent
# JPY >= 4500, CNY >= 230, USD >= 30, TWD >= 1000
from sqlalchemy import delete, case as sql_case, and_

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


async def recalculate_figure_snapshots(figure_id: int, db):
    """Recalculate all snapshots for a figure from its current listings.
    Called after adding or deleting listings.

    Snapshots cache aggregates in **TWD** (the platform's canonical currency, since
    almost all users are Taiwan-based). Cross-currency listings are converted via
    live rates at aggregation time. Display pages convert TWD→user_currency at
    query time via `currency.to_display`.
    """
    from collections import defaultdict
    today = date.today()
    rates = await _get_live_rates()

    # Rebuild from scratch (cheaper than diffing).
    await db.execute(delete(PriceSnapshot).where(PriceSnapshot.figure_id == figure_id))

    listings_result = await db.execute(
        select(Listing.price, Listing.currency, Listing.condition, Listing.sold_at, Listing.scraped_at)
        .where(Listing.figure_id == figure_id, Listing.price.isnot(None), Listing.price > 0)
    )
    listings = listings_result.all()

    if not listings:
        # No listings — clear figure-level cached prices.
        fig = await db.execute(select(Figure).where(Figure.id == figure_id))
        f = fig.scalar_one_or_none()
        if f:
            f.avg_price = None
            f.median_price = None
        return

    # Convert each listing into the canonical TWD value once, then bucket.
    by_date: dict[date, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    all_twd: list[float] = []
    for price, currency, condition, sold_at, scraped_at in listings:
        twd = _to_display(price, currency, "TWD", rates)
        if twd is None or twd <= 0:
            continue
        d = sold_at.date() if sold_at else (scraped_at.date() if scraped_at else today)
        cond = condition or "used"
        by_date[d]["all"].append(twd)
        by_date[d][cond].append(twd)
        all_twd.append(twd)

    for snap_date, conds in by_date.items():
        for cond, prices in conds.items():
            agg = _aggregate_prices(prices, trim_pct=10)
            db.add(PriceSnapshot(
                figure_id=figure_id, date=snap_date, condition=cond,
                avg_price=agg["avg"], median_price=agg["median"],
                min_price=agg["min"], max_price=agg["max"], sample_count=agg["count"],
            ))

    # Figure-level cached prices: trimmed-mean across every listing, in TWD.
    overall = _aggregate_prices(all_twd, trim_pct=10)
    fig = await db.execute(select(Figure).where(Figure.id == figure_id))
    f = fig.scalar_one_or_none()
    if f:
        f.avg_price = overall["avg"]
        f.median_price = overall["median"]


@router.get("")  # response shape depends on ?fields= (SearchResult | SearchResultCard)
async def search_figures(
    q: str = Query("", description="Search query"),
    scale: str = Query("", description="Filter by scale"),
    manufacturer: str = Query("", description="Filter by manufacturer"),
    series: str = Query("", description="Filter by series (locked-field — like manufacturer)"),
    franchise: str = Query("", description="Filter by franchise (作品) name — locked-field"),
    sculptor: str = Query("", description="Filter by sculptor"),
    character: str = Query("", description="Filter by exact character name"),
    painter: str = Query("", description="Filter by painter"),
    illustrator: str = Query("", description="Filter by illustrator"),
    figure_type: str = Query("", description="Filter by figure type"),
    sort: str = Query("", description="Sort: price_asc, price_desc, release_desc, name_asc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
    currency: str = Query("TWD", description="Display currency for returned prices"),
    fields: str = Query("full", pattern="^(full|card)$",
                        description="card = only the eight fields a grid tile renders"),
    db: AsyncSession = Depends(get_db),
):
    # Display currency: snapshots are cached in TWD (the platform's canonical unit);
    # convert at query time using live rates so cards everywhere show the same
    # number for the same figure. Always fetch live rates so retail (often JPY)
    # gets accurate conversion even when the display currency is TWD.
    # This is a search endpoint, not a catalogue dump. Unfiltered it will happily
    # enumerate every figure 100 at a time — 337 requests for the whole table,
    # inside the global 600/min budget — which makes it the cheapest bulk
    # extraction path in the product and undercuts the price data it took
    # scraping plus LLM matching to build. Nothing in the app asks for an
    # unfiltered list, so require at least one predicate.
    if not any([q, scale, manufacturer, series, franchise, sculptor,
                character, painter, illustrator, figure_type]):
        raise HTTPException(
            status_code=400,
            detail="至少需要一個搜尋條件",
        )

    display_currency = _normalize_currency(currency, default="TWD")
    rates = await _get_live_rates()
    # Subquery to get the latest snapshot date per figure
    latest_date = (
        select(
            PriceSnapshot.figure_id,
            func.max(PriceSnapshot.date).label("max_date"),
        )
        .where(PriceSnapshot.condition == "all")
        .group_by(PriceSnapshot.figure_id)
        .subquery()
    )
    # Join back to get full snapshot row
    latest_snapshot = (
        select(
            PriceSnapshot.figure_id,
            PriceSnapshot.avg_price,
            PriceSnapshot.median_price,
        )
        .where(PriceSnapshot.condition == "all")
        .join(
            latest_date,
            (PriceSnapshot.figure_id == latest_date.c.figure_id)
            & (PriceSnapshot.date == latest_date.c.max_date),
        )
        .subquery()
    )

    # Franchise is read from Figure.franchise_id (denormalised since 2026-05-24)
    # so editor batch-edits to franchise reflect in display without altering
    # the figure's character or other figures sharing it. Backfilled from
    # character.franchise_id so historical data is consistent.
    base_query = (
        select(Figure, func.coalesce(Character.name_zh, Character.name).label("char_name"), Franchise.name.label("fran_name"))
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Figure.franchise_id == Franchise.id)
    )

    # Build filter conditions
    # Default: filter out cheap items (under ~1000 NTD = 4500 JPY)
    filter_conditions = [_price_above_threshold(), Figure.figure_type != 'Q版人形']
    if q:
        import re as _re
        # Smart search: split query into tokens
        # Split on spaces, parentheses, brackets
        tokens = [t.strip() for t in _re.split(r"[\s（）()\[\]【】]+", q) if t.strip() and len(t.strip()) > 0]
        if not tokens:
            tokens = [q]
        
        # Common manufacturer aliases
        MFR_ALIASES = {
            "gsc": ["Good Smile Company", "良笑", "良笑塑美", "グッドスマイルカンパニー"],
            "alter": ["Alter", "アルター"],
            "freeing": ["FREEing", "フリーイング"],
            "kotobukiya": ["Kotobukiya", "壽屋", "コトブキヤ"],
            "bandai": ["BANDAI", "萬代", "バンダイ"],
            "max factory": ["Max Factory", "マックスファクトリー"],
            "apex": ["APEX-TOYS", "APEX"],
            "myethos": ["Myethos", "米哈遊"],
            "aniplex": ["Aniplex", "aniplex+"],
            "phat": ["Phat!", "Phat Company", "ファット・カンパニー"],
        }
        
        def _expand_token(token):
            """If token is a manufacturer alias, return all variants."""
            t_lower = token.lower()
            for key, aliases in MFR_ALIASES.items():
                if t_lower == key or t_lower in [a.lower() for a in aliases]:
                    return aliases
            return [token]

        def _token_matches(token):
            expanded = _expand_token(token)
            conditions = []
            for t in expanded:
                pattern = f"%{t}%"
                conditions.append(or_(
                    Figure.name.ilike(pattern),
                    Figure.original_name.ilike(pattern),
                    Figure.series.ilike(pattern),
                    Figure.manufacturer.ilike(pattern),
                    Figure.sculptor.ilike(pattern),
                    Figure.painter.ilike(pattern),
                    Figure.figure_type.ilike(pattern),
                    Character.name.ilike(pattern),
                    Character.name_zh.ilike(pattern),
                    Franchise.name.ilike(pattern),
                    Franchise.name_zh.ilike(pattern),
                ))
            return or_(*conditions)
        

        if len(tokens) == 1:
            filter_conditions.append(_token_matches(tokens[0]))
        else:
            # OR filter: at least one token must match
            filter_conditions.append(or_(*[_token_matches(t) for t in tokens]))
            # Will be used in ORDER BY below
    if scale:
        filter_conditions.append(Figure.scale == scale)
    if manufacturer:
        filter_conditions.append(Figure.manufacturer.ilike(f"%{manufacturer}%"))
    if series:
        filter_conditions.append(Figure.series.ilike(f"%{series}%"))
    if franchise:
        # `franchise` matches the series-level franchise (e.g. 約會大作戰).
        # Two-pronged: either Franchise.name OR name_zh matches, OR the figure's
        # `series` text contains it — covers both linked franchises and free-text entries.
        filter_conditions.append(
            or_(
                Franchise.name.ilike(f"%{franchise}%"),
                Franchise.name_zh.ilike(f"%{franchise}%"),
                Figure.series.ilike(f"%{franchise}%"),
            )
        )
    if sculptor:
        filter_conditions.append(Figure.sculptor.ilike(f"%{sculptor}%"))
    if painter:
        filter_conditions.append(Figure.painter.ilike(f"%{painter}%"))
    if illustrator:
        filter_conditions.append(Figure.illustrator.ilike(f"%{illustrator}%"))
    if figure_type:
        filter_conditions.append(Figure.figure_type.ilike(f"%{figure_type}%"))
    if character:
        filter_conditions.append(Character.name == character)

    for cond in filter_conditions:
        base_query = base_query.where(cond)

    # Count total — must use the same Franchise join path as base_query so
    # the count matches the rows we'd return. Was reading via character.franchise
    # while base_query was already on figure.franchise_id — inconsistent on drift.
    count_base = (
        select(func.count(Figure.id))
        .select_from(Figure)
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Figure.franchise_id == Franchise.id)
    )
    for cond in filter_conditions:
        count_base = count_base.where(cond)
    total_result = await db.execute(count_base)
    total = total_result.scalar() or 0

    # Fetch figures with latest prices
    query = (
        base_query.outerjoin(
            latest_snapshot, Figure.id == latest_snapshot.c.figure_id
        )
        .add_columns(
            latest_snapshot.c.avg_price.label("current_avg_price"),
            latest_snapshot.c.median_price.label("current_median_price"),
        )
    )

    # Sort price expression. snapshot.median_price is the canonical USD value (or TWD
    # after the canonical migration); fallback uses a SQL CASE matching the central
    # FALLBACK_RATES so non-JPY retails (TWD/CNY/USD) sort correctly.
    from sqlalchemy import case as _sort_case
    _retail_to_usd_sql = cast(Figure.retail_price, Float) / _sort_case(
        (Figure.retail_currency == "TWD", 32.2),
        (Figure.retail_currency == "CNY", 7.25),
        (Figure.retail_currency == "USD", 1.0),
        else_=149.5,  # JPY default
    )
    sort_price = func.coalesce(latest_snapshot.c.median_price, _retail_to_usd_sql)

    # Apply sorting
    if sort == "price_asc":
        query = query.order_by(sort_price.asc().nullslast())
    elif sort == "price_desc":
        query = query.order_by(sort_price.desc().nullslast())
    elif sort == "release_desc":
        query = query.order_by(Figure.release_year.desc().nullslast(), Figure.id.desc())
    elif sort == "name_asc":
        query = query.order_by(Figure.name.asc())
    else:
        if q and " " in q:
            # Build SQL-level match score: count how many tokens match
            from sqlalchemy import case as _sql_case, literal as _lit
            _match_scores = []
            for t in tokens:
                expanded = _expand_token(t)
                token_conds = []
                for et in expanded:
                    p = f"%{et}%"
                    token_conds.append(Figure.name.ilike(p))
                    token_conds.append(Figure.original_name.ilike(p))
                    token_conds.append(Figure.manufacturer.ilike(p))
                    token_conds.append(Character.name.ilike(p))
                    token_conds.append(Franchise.name.ilike(p))
                _match_scores.append(_sql_case((or_(*token_conds), 1), else_=0))
            _total_score = sum(_match_scores)
            query = query.order_by(_total_score.desc(), func.coalesce(Figure.view_count, 0).desc(), Figure.id.desc())
        else:
            query = query.order_by(Figure.id.desc())

    # For multi-word queries, fetch from offset 0 for consistent re-ranking
    if q and " " in q:
        _fetch_limit = min(skip + limit * 5, 600)  # Fetch enough for current page
        query = query.offset(0).limit(_fetch_limit)
    else:
        query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    # Helper: convert a TWD-canonical price to display currency. Same-currency short-circuits.
    def _conv(p):
        if p is None:
            return None
        if display_currency == "TWD":
            return float(p)
        return _to_display(p, "TWD", display_currency, rates)

    figures = []
    for row in rows:
        figure = row[0]  # Figure object
        char_name = row[1]  # Character.name_zh
        fran_name = row[2]  # Franchise.name
        current_avg = _conv(row[3])
        current_median = _conv(row[4])
        # price_change_pct vs retail — both sides in display currency.
        # `_retail_to_display` handles USD pass-through internally via FALLBACK_RATES,
        # so we no longer need a separate USD-special-case path.
        price_change_pct = None
        if current_median is not None and figure.retail_price:
            retail_d = _retail_to_display(
                figure.retail_price, getattr(figure, "retail_currency", "JPY"),
                display_currency, rates or {},
            )
            if retail_d and retail_d > 0:
                price_change_pct = round((current_median - retail_d) / retail_d * 100, 1)

        fig_out = FigureOut(
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
            sculptor=figure.sculptor,
            painter=figure.painter,
            illustrator=figure.illustrator,
            dimensions=figure.dimensions,
            material=figure.material,
            gender=figure.gender,
            figure_type=figure.figure_type,
            age_rating=figure.age_rating,
            release_date=figure.release_date,
            reissue_dates=figure.reissue_dates,
            official_url=figure.official_url,
            character_name=char_name,
            franchise_name=fran_name,
            current_avg_price=current_avg,
            current_median_price=current_median,
            price_change_pct=price_change_pct,
            price_trend_pct=None,
        )
        figures.append(fig_out)

    # Fallback: figures with listings but no snapshots — recompute from raw (price, currency)
    # so the result honours `display_currency` instead of leaking USD numbers.
    no_price_ids = [f.id for f in figures if f.current_avg_price is None and f.current_median_price is None]
    if no_price_ids:
        for fid in no_price_ids:
            listing_result = await db.execute(
                select(Listing.price, Listing.currency).where(
                    Listing.figure_id == fid,
                    Listing.price.isnot(None),
                    Listing.price > 0,
                )
            )
            # rates can be None when display_currency==USD (no live rates fetched).
            # _to_display handles None gracefully via its internal fallback table.
            _r = rates or {}
            converted = [
                v for (p, c) in listing_result.all()
                if (v := _to_display(p, c, display_currency, _r)) is not None and v > 0
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

    # Re-rank: more matching tokens = higher rank
    if q and " " in q:
        import re as _re2
        _ALIASES = {
            "gsc": ["Good Smile Company", "良笑", "良笑塑美"],
            "alter": ["Alter"], "freeing": ["FREEing"],
            "kotobukiya": ["Kotobukiya", "壽屋"],
            "max factory": ["Max Factory"],
            "apex": ["APEX-TOYS", "APEX"],
            "myethos": ["Myethos"],
        }
        _toks = [t.strip().lower() for t in _re2.split(r"[\s（）()\[\]【】]+", q) if t.strip()]
        def _exp(t):
            for k, v in _ALIASES.items():
                if t == k or t in [a.lower() for a in v]:
                    return [k] + v
            return [t]
        _exps = [_exp(t) for t in _toks]
        def _sc(f):
            txt = " ".join([f.name or "", getattr(f, "original_name", "") or "", f.manufacturer or "", getattr(f, "character_name", "") or "", getattr(f, "franchise_name", "") or ""]).lower()
            return sum(1 for vs in _exps if any(v.lower() in txt for v in vs))
        figures.sort(key=lambda f: (-_sc(f), -(getattr(f, "current_median_price", None) or 0)))
        figures = figures[skip:skip + limit]

    if fields == "card":
        # Same query, lighter wire format — grids never read the other 22 fields.
        return SearchResultCard(
            figures=[FigureCardOut.model_validate(f) for f in figures],
            total=total,
        )
    return SearchResult(figures=figures, total=total)


@router.get("/sitemap-ids")
async def get_sitemap_ids(db: AsyncSession = Depends(get_db)):
    """Return all valid figure IDs for sitemap generation.

    Previously only included figures with listings (~1.7K of 37K), pairing with
    a thin-content noindex on figures without listings. That was overcautious —
    every figure page has unique product data (name/manufacturer/character/
    image/JSON-LD Product schema) and is worth being indexed for long-tail
    discovery. Now: include any figure that has an image (i.e. is a real,
    presentable entry, not a stub), which is ~37K well under Google's 50K
    per-sitemap limit."""
    from sqlalchemy import text as _t
    result = await db.execute(_t(
        "SELECT id FROM figures WHERE image_url IS NOT NULL ORDER BY id"
    ))
    return {"ids": [row[0] for row in result.all()]}


@router.get("/{figure_id}", response_model=FigureDetail)
async def get_figure(
    figure_id: int,
    currency: str = "TWD",
    db: AsyncSession = Depends(get_db),
) -> FigureDetail:
    # Display currency: convert all aggregates on-the-fly using live rates.
    # DB stores listings in their original (price, currency); we convert at query time.
    # Default is TWD (the platform's canonical unit) since this is a Taiwan-focused
    # site. Other currencies are computed via live exchange rates.
    display_currency = currency.upper() if currency.upper() in _VALID_CURRENCIES else "TWD"
    rates = await _get_live_rates()
    # Fetch figure with character/franchise.
    # Franchise reads via Figure.franchise_id (denormalised) so editors' batch
    # edits to franchise reflect in display without changing the character.
    result = await db.execute(
        select(Figure, func.coalesce(Character.name_zh, Character.name).label("char_name"), Franchise.name.label("fran_name"))
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Figure.franchise_id == Franchise.id)
        .where(Figure.id == figure_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Figure not found")
    figure = row[0]
    char_name = row[1]
    fran_name = row[2]

    # Last 5 listings
    listings_result = await db.execute(
        select(Listing)
        .where(Listing.figure_id == figure_id)
        .order_by(Listing.scraped_at.desc())
        .limit(50)
    )
    recent_listings = []
    for l in listings_result.scalars().all():
        out = ListingOut.model_validate(l)
        if not out.sold_at and l.scraped_at:
            out.sold_at = l.scraped_at
        recent_listings.append(out)

    # Price history: aggregate from raw (price, currency) grouped by sold_at date,
    # converting each listing to display_currency on-the-fly using live rates.
    from collections import defaultdict
    _hist_listings = await db.execute(
        select(Listing.price, Listing.currency, Listing.condition, Listing.sold_at, Listing.scraped_at)
        .where(Listing.figure_id == figure_id, Listing.price.isnot(None), Listing.price > 0)
        .order_by(Listing.sold_at.asc().nullslast())
    )
    _by_date: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for _p, _curr, _c, _sold, _scraped in _hist_listings.all():
        _dt = _sold or _scraped
        if _dt:
            # Convert to Taiwan time so chart dates match what Taiwan users see
            _d = _dt.astimezone(_TW).date() if _dt.tzinfo else _dt.date()
        else:
            _d = date.today()
        _date_str = str(_d)
        _cond = _c if _c in ("sealed", "opened", "used", "damaged") else "used"
        _converted = _to_display(_p, _curr, display_currency, rates)
        if _converted is None or _converted <= 0:
            continue
        _by_date[_date_str]["all"].append(_converted)
        _by_date[_date_str][_cond].append(_converted)

    def _make_snap(d_str, prices):
        agg = _aggregate_prices(prices)
        return PriceSnapshotOut(
            date=date.fromisoformat(d_str),
            avg_price=agg["avg"], median_price=agg["median"],
            min_price=agg["min"], max_price=agg["max"], sample_count=agg["count"],
        )

    price_history = []
    price_history_by_condition: dict[str, list] = {}
    for d_str in sorted(_by_date.keys()):
        cond_data = _by_date[d_str]
        if "all" in cond_data:
            price_history.append(_make_snap(d_str, cond_data["all"]))
        for cond, prices in cond_data.items():
            if cond not in price_history_by_condition:
                price_history_by_condition[cond] = []
            price_history_by_condition[cond].append(_make_snap(d_str, prices))

    # Condition-based pricing from all sold listings (no time window).
    # Using all-time data keeps the code simple and ensures figures with
    # infrequent trades always show condition price cards.
    all_listings_result = await db.execute(
        select(Listing).where(
            Listing.figure_id == figure_id,
            Listing.is_sold == True,
        )
    )
    all_listings = all_listings_result.scalars().all()

    from collections import defaultdict

    condition_groups: dict[str, list[float]] = defaultdict(list)
    for listing in all_listings:
        group = classify_condition(listing.condition)
        # Convert to display currency on-the-fly (preserves original number when same currency).
        converted = _to_display(listing.price, listing.currency, display_currency, rates)
        if converted is not None and converted > 0:
            condition_groups[group].append(converted)

    condition_prices = []
    labels = {"sealed": "全新", "opened": "拆檢", "used": "拆擺", "damaged": "瑕疵"}
    for cond, prices in condition_groups.items():
        if not prices:
            continue
        agg = _aggregate_prices(prices)
        condition_prices.append(
            ConditionPriceOut(
                condition=cond,
                condition_label=labels.get(cond, cond),
                avg_price=agg["avg"], median_price=agg["median"],
                min_price=agg["min"], max_price=agg["max"], sample_count=agg["count"],
            )
        )

    # Related figures: same character, or same franchise
    rel_latest_date = (
        select(
            PriceSnapshot.figure_id,
            func.max(PriceSnapshot.date).label("max_date"),
        )
        .where(PriceSnapshot.condition == "all")
        .group_by(PriceSnapshot.figure_id)
        .subquery()
    )
    rel_snap = (
        select(
            PriceSnapshot.figure_id,
            PriceSnapshot.median_price,
        )
        .where(PriceSnapshot.condition == "all")
        .join(
            rel_latest_date,
            (PriceSnapshot.figure_id == rel_latest_date.c.figure_id)
            & (PriceSnapshot.date == rel_latest_date.c.max_date),
        )
        .subquery()
    )

    def build_related(fig_row) -> FigureRelated:
        # Snapshot.median_price is in TWD (canonical). Convert to the request's
        # display currency so FigureCard can format-and-symbol without re-converting.
        f = fig_row[0]
        median_twd = fig_row[1] if len(fig_row) > 1 else None
        median_display = _to_display(median_twd, "TWD", display_currency, rates) if median_twd is not None else None
        pcp = None
        if median_display is not None and f.retail_price:
            retail_display = _retail_to_display(
                f.retail_price, getattr(f, "retail_currency", "JPY"),
                display_currency, rates or {},
            )
            if retail_display > 0:
                pcp = round((median_display - retail_display) / retail_display * 100, 1)
        return FigureRelated(id=f.id, name=f.name, image_url=f.image_url, manufacturer=f.manufacturer, retail_price=f.retail_price, retail_currency=f.retail_currency or "JPY", current_median_price=median_display, price_change_pct=pcp)

    related = []
    if figure.character_id:
        related_result = await db.execute(
            select(Figure, rel_snap.c.median_price)
            .outerjoin(rel_snap, Figure.id == rel_snap.c.figure_id)
            .where(
                Figure.character_id == figure.character_id,
                Figure.id != figure.id,
                Figure.image_url.isnot(None),
                _price_above_threshold(),
            )
            .order_by(func.coalesce(Figure.view_count, 0).desc())
            .limit(12)
        )
        related = [build_related(r) for r in related_result.all()]

    # If not enough from same character, fill with same franchise
    if len(related) < 6 and figure.character_id:
        char_result = await db.execute(select(Character.franchise_id).where(Character.id == figure.character_id))
        fran_id = char_result.scalar_one_or_none()
        if fran_id:
            existing_ids = {r.id for r in related} | {figure.id}
            franchise_result = await db.execute(
                select(Figure, rel_snap.c.median_price)
                .outerjoin(rel_snap, Figure.id == rel_snap.c.figure_id)
                .join(Character, Figure.character_id == Character.id)
                .where(
                    Character.franchise_id == fran_id,
                    Figure.id.notin_(existing_ids),
                    Figure.image_url.isnot(None),
                    _price_above_threshold(),
                )
                .order_by(func.coalesce(Figure.view_count, 0).desc())
                .limit(12 - len(related))
            )
            related.extend([build_related(r) for r in franchise_result.all()])

    # Calculate price change %
    # Current price from all-time sold listings (no window), in display_currency.
    # Outliers are trimmed 10% from each end when sample is large enough.
    listing_prices = [
        v for l in all_listings
        if (v := _to_display(l.price, l.currency, display_currency, rates)) is not None and v > 0
    ]
    _summary = _aggregate_prices(listing_prices, trim_pct=10)
    current_avg = _summary["avg"]
    current_median = _summary["median"]
    price_change_pct = None
    if current_median is not None and figure.retail_price:
        retail_in_display = _retail_to_display(
            figure.retail_price, getattr(figure, "retail_currency", "JPY"),
            display_currency, rates,
        )
        if retail_in_display > 0:
            price_change_pct = round((current_median - retail_in_display) / retail_in_display * 100, 1)

    # Calculate price trend from last 2 snapshots (also in display_currency)
    price_trend_pct = None
    if len(price_history) >= 2:
        latest_p = price_history[-1].avg_price
        prev_p = price_history[-2].avg_price
        if prev_p and prev_p > 0 and latest_p:
            price_trend_pct = round((latest_p - prev_p) / prev_p * 100, 1)
    elif all_listings and len(all_listings) >= 2:
        sold_prices = sorted(
            [
                (v, l.scraped_at)
                for l in all_listings
                if (v := _to_display(l.price, l.currency, display_currency, rates)) is not None and v > 0
            ],
            key=lambda x: x[1],
            reverse=True,
        )
        if len(sold_prices) >= 2:
            latest_p = sold_prices[0][0]
            prev_p = sold_prices[1][0]
            if prev_p > 0:
                price_trend_pct = round((latest_p - prev_p) / prev_p * 100, 1)

    # Synthetic price_history entry if empty but listings exist
    if not price_history and current_avg is not None:
        price_history = [PriceSnapshotOut(
            date=date.today(),
            avg_price=current_avg,
            median_price=current_median,
            min_price=_summary["min"],
            max_price=_summary["max"],
            sample_count=_summary["count"],
        )]

    # Get aggregate rating
    from sqlalchemy import text as _rt
    _rating_result = await db.execute(_rt(
        "SELECT AVG(rating)::numeric(3,1), COUNT(*) FROM figure_ratings WHERE figure_id = :fid"
    ), {"fid": figure.id})
    _rr = _rating_result.first()
    _rating_avg = float(_rr[0]) if _rr and _rr[0] else None
    _rating_count = _rr[1] if _rr else 0

    # Pre-compute retail in display currency so frontend doesn't need to convert.
    retail_display = (
        round(_retail_to_display(figure.retail_price, figure.retail_currency, display_currency, rates), 2)
        if figure.retail_price else None
    )

    return FigureDetail(
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
        retail_price_display=retail_display,
        sculptor=figure.sculptor,
        painter=figure.painter,
        illustrator=figure.illustrator,
        dimensions=figure.dimensions,
        material=figure.material,
        gender=figure.gender,
        figure_type=figure.figure_type,
        age_rating=figure.age_rating,
        release_date=figure.release_date,
        reissue_dates=figure.reissue_dates,
        hpoi_link=figure.hpoi_link,
        official_url=figure.official_url,
        character_name=char_name,
        franchise_name=fran_name,
        current_avg_price=current_avg,
        current_median_price=current_median,
        price_change_pct=price_change_pct,
        price_trend_pct=price_trend_pct,
        recent_listings=recent_listings,
        price_history=price_history,
        price_history_by_condition=price_history_by_condition,
        condition_prices=condition_prices,
        related_figures=related,
        rating_avg=_rating_avg,
        rating_count=_rating_count,
    )


@router.get("/{figure_id}/prices", response_model=list[PriceSnapshotOut])
async def get_price_history(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[PriceSnapshotOut]:
    history_result = await db.execute(
        select(PriceSnapshot)
        .where(PriceSnapshot.figure_id == figure_id)
        .where(PriceSnapshot.condition == "all")
        .order_by(PriceSnapshot.date.asc())
    )
    return [
        PriceSnapshotOut.model_validate(s)
        for s in history_result.scalars().all()
    ]


@router.post("/{figure_id}/report")
async def submit_price_report(
    figure_id: int,
    report: PriceReportIn,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user_optional),
) -> dict:
    # Validate price

    # Validate price is a positive integer
    if not isinstance(report.price, int) or report.price <= 0:
        raise HTTPException(status_code=400, detail="Price must be a positive integer")
    if report.price > 10000000:  # 10M cap
        raise HTTPException(status_code=400, detail="Price too high")
    if report.currency not in ("TWD", "JPY", "CNY", "USD"):
        raise HTTPException(status_code=400, detail="Invalid currency")

    # Load figure once (used for retail comparison and for listing title)
    fig_result = await db.execute(select(Figure).where(Figure.id == figure_id))
    figure = fig_result.scalar_one_or_none()
    if not figure:
        raise HTTPException(status_code=404, detail="Figure not found")

    # Rate limit: max 10 reports per figure per hour
    from datetime import timedelta
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count_result = await db.execute(
        select(func.count(UserReport.id)).where(
            UserReport.figure_id == figure_id,
            UserReport.created_at >= one_hour_ago,
        )
    )
    recent_count = recent_count_result.scalar() or 0
    if recent_count >= 10:
        raise HTTPException(status_code=429, detail="Too many reports for this figure. Please try later.")

    # Outlier detection: convert everything to JPY (or any common pivot) and compare.
    # Uses fallback rates from the central currency module — outlier thresholds are
    # rate-insensitive so we don't bother fetching live rates here.
    def _to_jpy(p, c):
        return _to_display(p, c, "JPY", {}) or 0.0

    flagged = False
    flag_reason = ""

    if figure and figure.retail_price:
        price_jpy_for_check = _to_jpy(report.price, report.currency)
        retail_jpy = _to_jpy(figure.retail_price, figure.retail_currency or "JPY")
        ratio = price_jpy_for_check / retail_jpy if retail_jpy > 0 else 1
        if ratio > 5.0:
            flagged = True
            flag_reason = f"Price is {ratio:.1f}x retail"
        elif ratio < 0.05:
            flagged = True
            flag_reason = f"Price is only {ratio:.1%} of retail"

    existing = await db.execute(
        select(UserReport.price, UserReport.currency)
        .where(UserReport.figure_id == figure_id)
        .order_by(UserReport.created_at.desc())
        .limit(20)
    )
    existing_reports = existing.all()
    if len(existing_reports) >= 3:
        prices_jpy = sorted(_to_jpy(ep, ec) for ep, ec in existing_reports)
        median_jpy = prices_jpy[len(prices_jpy) // 2]
        if median_jpy > 0:
            price_jpy_for_check = _to_jpy(report.price, report.currency)
            dev = abs(price_jpy_for_check - median_jpy) / median_jpy
            if dev > 1.0:
                flagged = True
                flag_reason = f"Price deviates {dev:.0%} from median"

    user_report = UserReport(
        figure_id=figure_id,
        price=report.price,
        currency=report.currency,
        condition=report.condition,
        platform=report.platform,
        notes=("⚠️ " + flag_reason + " | " if flagged else "") + (report.notes or ""),
        user_id=current_user.id if current_user else None,
    )
    db.add(user_report)
    await db.flush()  # get user_report.id

    # Parse and validate sold_at date (server-side). Clamp to [today-10y, today].
    _sold_at = None
    if report.sold_at:
        try:
            from datetime import datetime as _dt, timedelta as _td, timezone as _tz
            _sold_at = _dt.fromisoformat(report.sold_at)
            _tw = _tz(_td(hours=8))
            _now_tw = _dt.now(_tw)
            _today_tw = _now_tw.replace(hour=23, minute=59, second=59)
            _earliest = _now_tw - _td(days=365 * 10)
            if _sold_at.tzinfo is None:
                _sold_at = _sold_at.replace(tzinfo=_tw)

            if _sold_at > _today_tw:
                _sold_at = _now_tw  # clamp future → today
            elif _sold_at < _earliest:
                _sold_at = None  # reject implausibly old dates
        except (ValueError, TypeError):
            _sold_at = None

    # If not flagged, also create a listing so it affects price calculations.
    if not flagged:
        # The `price_canonical` column is a legacy name — its contents are now the canonical
        # TWD-denominated value used by snapshot ranking and trending SQL.
        rates = await _get_live_rates()
        canonical_twd = _to_display(report.price, report.currency, "TWD", rates) or 0.0
        condition_map = {"sealed": "sealed", "opened": "opened", "displayed": "used", "damaged": "damaged"}
        listing = Listing(
            figure_id=figure_id,
            source="user_report",
            source_id=f"ur_{user_report.id}_{figure_id}",
            title=figure.name + " - " + (report.platform or "社群回報"),
            price=report.price,
            currency=report.currency,
            price_canonical=round(canonical_twd, 2),
            condition=condition_map.get(report.condition, "used"),
            is_sold=True,
            notes=report.notes,
            sold_at=_sold_at,
        )
        db.add(listing)


    # Recalculate snapshots after adding new listing
    if not flagged:
        try:
            await recalculate_figure_snapshots(figure_id, db)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Snapshot recalc failed for figure_id=%s", figure_id)

    await db.commit()

    return {"status": "success", "message": "感謝回報！" if not flagged else "已收到，價格將經過審核。"}




# ── Figure Notes (community notes) ──────────────────────────────

@router.get("/{figure_id}/rating")
async def get_figure_rating(figure_id: int, db: AsyncSession = Depends(get_db)):
    """Get aggregate rating for a figure."""
    from sqlalchemy import text as sql_text
    result = await db.execute(sql_text(
        "SELECT AVG(rating)::numeric(3,1), COUNT(*) FROM figure_ratings WHERE figure_id = :fid"
    ), {"fid": figure_id})
    row = result.first()
    avg = float(row[0]) if row and row[0] else None
    count = row[1] if row else 0
    return {"average": avg, "count": count}


@router.post("/{figure_id}/rating")
async def rate_figure(
    figure_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user_optional),
):
    """Rate a figure 1-5. One rating per user (or per IP if anonymous).
    Rate-limited to 30 ratings per IP per hour to curb bulk manipulation."""
    from sqlalchemy import text as sql_text
    rating = body.get("rating")
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")

    ip = get_real_ip(request)

    # Rate limit: 30 ratings per IP per hour (Redis + in-memory fallback)
    from rate_limit import check_rate_limit, get_redis
    _redis = await get_redis()
    if not await check_rate_limit(_redis, f"rating:{ip}", limit=30, window_seconds=3600):
        if _redis is not None:
            try:
                await _redis.aclose()
            except Exception:
                pass
        raise HTTPException(status_code=429, detail="評分太頻繁，請稍後再試")
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass

    if current_user:
        # Upsert by user_id
        await db.execute(sql_text("""
            INSERT INTO figure_ratings (figure_id, user_id, ip, rating)
            VALUES (:fid, :uid, :ip, :rating)
            ON CONFLICT (figure_id, user_id) DO UPDATE SET rating = :rating
        """), {"fid": figure_id, "uid": current_user.id, "ip": ip, "rating": rating})
    else:
        # Upsert by IP
        await db.execute(sql_text("""
            INSERT INTO figure_ratings (figure_id, ip, rating)
            VALUES (:fid, :ip, :rating)
            ON CONFLICT (figure_id, ip) DO UPDATE SET rating = :rating
        """), {"fid": figure_id, "ip": ip, "rating": rating})

    await db.commit()
    return {"status": "ok"}


@router.get("/{figure_id}/notes")
async def get_figure_notes(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get visible notes for a figure."""
    from sqlalchemy import text as sql_text
    result = await db.execute(
        sql_text("""
            SELECT id, content, link_url, created_at, report_count
            FROM figure_notes
            WHERE figure_id = :fid AND status = 'visible'
            ORDER BY created_at DESC
            LIMIT 50
        """),
        {"fid": figure_id}
    )
    return [
        {"id": r[0], "content": r[1], "link_url": r[2],
         "created_at": r[3].isoformat() if r[3] else None, "report_count": r[4]}
        for r in result.all()
    ]


@router.post("/{figure_id}/notes")
async def add_figure_note(
    figure_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user_optional),
):
    """Add a community note to a figure."""
    content_text = (body.get("content") or "").strip()
    link_url = (body.get("link_url") or "").strip() or None

    if not content_text:
        raise HTTPException(status_code=400, detail="Content is required")
    if len(content_text) > 500:
        raise HTTPException(status_code=400, detail="Content too long (max 500 chars)")
    if link_url:
        if len(link_url) > 1000:
            raise HTTPException(status_code=400, detail="URL too long")
        # Only allow http(s) — blocks javascript:, data:, etc.
        if not (link_url.lower().startswith("http://") or link_url.lower().startswith("https://")):
            raise HTTPException(status_code=400, detail="連結必須以 http:// 或 https:// 開頭")
    
    # Check figure exists
    fig = await db.execute(select(Figure.id).where(Figure.id == figure_id))
    if not fig.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Figure not found")
    
    # IP-based rate limit: max 10 notes per hour globally
    import redis.asyncio as aioredis
    import os
    try:
        _r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        _ip = get_real_ip(request)
        _key = f"note_create:{_ip}"
        _cnt = await _r.incr(_key)
        if _cnt == 1:
            await _r.expire(_key, 3600)
        await _r.aclose()
        if _cnt > 10:
            raise HTTPException(status_code=429, detail="筆記發送過於頻繁，請稍後再試")
    except HTTPException:
        raise
    except Exception:
        pass

    # Rate limit: max 3 notes per figure per hour
    from sqlalchemy import text as sql_text
    recent = await db.execute(
        sql_text("SELECT COUNT(*) FROM figure_notes WHERE figure_id = :fid AND created_at >= NOW() - INTERVAL '1 hour'"),
        {"fid": figure_id}
    )
    if (recent.scalar() or 0) >= 3:
        raise HTTPException(status_code=429, detail="Too many notes. Try later.")
    
    await db.execute(
        sql_text("INSERT INTO figure_notes (figure_id, content, link_url, user_id) VALUES (:fid, :content, :link, :uid)"),
        {"fid": figure_id, "content": content_text, "link": link_url, "uid": current_user.id if current_user else None}
    )
    await db.commit()
    return {"status": "success", "message": "筆記已新增"}


@router.post("/{figure_id}/notes/{note_id}/report")
async def report_figure_note(
    figure_id: int,
    note_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Report a note as abuse. Auto-hides after 5 reports. Creates error_report for admin."""
    from sqlalchemy import text as sql_text

    # IP-based rate limit: max 5 note reports per hour
    import redis.asyncio as aioredis
    import os
    try:
        r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        ip = get_real_ip(request)
        key = f"note_report:{ip}"
        attempts = await r.incr(key)
        if attempts == 1:
            await r.expire(key, 3600)
        await r.aclose()
        if attempts > 5:
            raise HTTPException(status_code=429, detail="檢舉次數過多，請稍後再試")
    except HTTPException:
        raise
    except Exception:
        pass

    # Increment report count
    await db.execute(
        sql_text("UPDATE figure_notes SET report_count = report_count + 1 WHERE id = :nid AND figure_id = :fid"),
        {"nid": note_id, "fid": figure_id}
    )
    # Auto-hide if >= 5 reports (raised from 3 to prevent single-actor abuse)
    await db.execute(
        sql_text("UPDATE figure_notes SET status = 'hidden' WHERE id = :nid AND report_count >= 5"),
        {"nid": note_id}
    )

    # Get note content for error report description
    row = (await db.execute(
        sql_text("SELECT content FROM figure_notes WHERE id = :nid"),
        {"nid": note_id}
    )).first()
    note_preview = (row[0][:80] + "...") if row and len(row[0]) > 80 else (row[0] if row else "")

    # Create error report so admin sees it in error reports tab
    await db.execute(
        sql_text(
            "INSERT INTO error_reports (figure_id, report_type, description, status) "
            "VALUES (:fid, 'note_abuse', :desc, 'pending')"
        ),
        {"fid": figure_id, "desc": f"Note #{note_id} 被檢舉濫用: {note_preview}"}
    )

    await db.commit()
    return {"status": "reported"}

@router.post("/submissions", response_model=FigureSubmissionOut)
async def submit_figure(
    submission: FigureSubmissionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> FigureSubmissionOut:
    """Submit a new figure that's not yet in the database.
    Rate-limited to 5 submissions per IP per hour."""
    ip = get_real_ip(request)
    from rate_limit import check_rate_limit, get_redis
    _redis = await get_redis()
    if not await check_rate_limit(_redis, f"submit_figure:{ip}", limit=5, window_seconds=3600):
        if _redis is not None:
            try:
                await _redis.aclose()
            except Exception:
                pass
        raise HTTPException(status_code=429, detail="提交太頻繁，請稍後再試")
    if _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass

    from db.models import FigureSubmission
    new_sub = FigureSubmission(
        name=submission.name,
        original_name=submission.original_name,
        character_name=submission.character_name,
        franchise_name=submission.franchise_name,
        manufacturer=submission.manufacturer,
        version_name=submission.version_name,
        series=submission.series,
        scale=submission.scale,
        jan_code=submission.jan_code,
        image_url=submission.image_url,
        notes=submission.notes,
        retail_price=submission.retail_price,
        retail_currency=submission.retail_currency,
        figure_type=submission.figure_type,
        age_rating=submission.age_rating,
        material=submission.material,
        sculptor=submission.sculptor,
        painter=submission.painter,
        illustrator=submission.illustrator,
        dimensions=submission.dimensions,
        gender=submission.gender,
        release_date=submission.release_date,
        hpoi_link=submission.hpoi_link,
        official_url=submission.official_url,
        status="pending",
    )
    db.add(new_sub)
    await db.commit()
    await db.refresh(new_sub)
    return FigureSubmissionOut.model_validate(new_sub)


@router.get("/{figure_id}/condition-prices")
async def get_condition_prices(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get latest prices broken down by condition (all, sealed, used)."""
    result = {}
    for cond in ["all", "sealed", "used"]:
        snap = (await db.execute(
            select(PriceSnapshot)
            .where(PriceSnapshot.figure_id == figure_id)
            .where(PriceSnapshot.condition == cond)
            .order_by(PriceSnapshot.date.desc())
            .limit(1)
        )).scalar_one_or_none()
        if snap:
            result[cond] = {
                "avg_price": float(snap.avg_price) if snap.avg_price else None,
                "median_price": float(snap.median_price) if snap.median_price else None,
                "min_price": float(snap.min_price) if snap.min_price else None,
                "max_price": float(snap.max_price) if snap.max_price else None,
                "sample_count": snap.sample_count,
                "date": str(snap.date),
            }
    return result
