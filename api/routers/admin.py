from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from auth import require_editor, require_admin, get_current_user
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Character, ErrorReport, Figure, FigureSubmission, Franchise, Listing, PriceSnapshot, UserReport
from routers.figures import recalculate_figure_snapshots
from schemas import ErrorReportOut, FigureSubmissionOut

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_editor)])


# ── Figure Submissions ──────────────────────────────────────────────

@router.get("/submissions")
async def list_submissions(
    status: str = Query("pending", description="Filter by status: pending, approved, rejected, all"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(FigureSubmission).order_by(FigureSubmission.created_at.desc())
    if status != "all":
        query = query.where(FigureSubmission.status == status)
    query = query.offset(skip).limit(limit)

    count_query = select(func.count(FigureSubmission.id))
    if status != "all":
        count_query = count_query.where(FigureSubmission.status == status)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    result = await db.execute(query)
    submissions = result.scalars().all()

    items = []
    for s in submissions:
        items.append({
            "id": s.id,
            "name": s.name,
            "original_name": s.original_name,
            "character_name": s.character_name,
            "franchise_name": s.franchise_name,
            "manufacturer": s.manufacturer,
            "version_name": s.version_name,
            "series": s.series,
            "scale": s.scale,
            "jan_code": s.jan_code,
            "image_url": s.image_url,
            "notes": s.notes,
            "retail_price": s.retail_price,
            "retail_currency": s.retail_currency or "JPY",
            "figure_type": s.figure_type,
            "age_rating": s.age_rating,
            "material": s.material,
            "sculptor": s.sculptor,
            "painter": s.painter,
            "dimensions": s.dimensions,
            "gender": s.gender,
            "release_date": s.release_date,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        })

    return {"items": items, "total": total}


@router.post("/submissions/{submission_id}/approve")
async def approve_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Approve a figure submission: create the figure, character, franchise as needed."""
    result = await db.execute(
        select(FigureSubmission).where(FigureSubmission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status != "pending":
        raise HTTPException(status_code=400, detail=f"Submission already {sub.status}")

    # Find or create franchise
    franchise_id = None
    if sub.franchise_name:
        fran_result = await db.execute(
            select(Franchise).where(Franchise.name == sub.franchise_name)
        )
        franchise = fran_result.scalar_one_or_none()
        if not franchise:
            franchise = Franchise(name=sub.franchise_name)
            db.add(franchise)
            await db.flush()
        franchise_id = franchise.id

    # Find or create character
    character_id = None
    if sub.character_name and franchise_id:
        char_result = await db.execute(
            select(Character).where(
                Character.name == sub.character_name,
                Character.franchise_id == franchise_id,
            )
        )
        character = char_result.scalar_one_or_none()
        if not character:
            character = Character(name=sub.character_name, franchise_id=franchise_id)
            db.add(character)
            await db.flush()
        character_id = character.id
    elif sub.character_name:
        # Character without franchise — create a placeholder franchise
        placeholder_fran = Franchise(name=sub.character_name)
        db.add(placeholder_fran)
        await db.flush()
        character = Character(name=sub.character_name, franchise_id=placeholder_fran.id)
        db.add(character)
        await db.flush()
        character_id = character.id

    # Store original price and currency as-is — conversion happens in real-time on frontend
    retail_price_jpy = sub.retail_price

    # Parse release_year from release_date
    release_year = None
    if sub.release_date:
        try:
            parts = sub.release_date.replace("-", "/").split("/")
            release_year = int(parts[0])
        except (ValueError, IndexError):
            pass

    # Convert empty strings to None to avoid unique constraint violations
    def _e2n(v):
        return v if v and v.strip() else None

    # Create figure
    new_figure = Figure(
        name=sub.name,
        original_name=_e2n(sub.original_name),
        character_id=character_id,
        manufacturer=sub.manufacturer,
        version_name=_e2n(sub.version_name),
        series=_e2n(sub.series),
        scale=sub.scale,
        jan_code=_e2n(sub.jan_code),
        image_url=sub.image_url,
        retail_price=retail_price_jpy,
        retail_currency=sub.retail_currency or "JPY",
        figure_type=sub.figure_type,
        age_rating=sub.age_rating,
        material=sub.material,
        sculptor=sub.sculptor,
        painter=sub.painter,
        dimensions=sub.dimensions,
        gender=sub.gender,
        release_date=sub.release_date,
        release_year=release_year,
    )
    db.add(new_figure)

    # Update submission status
    sub.status = "approved"
    sub.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(new_figure)

    return {"status": "approved", "figure_id": new_figure.id, "message": f"已建立公仔: {new_figure.name}"}


@router.post("/submissions/{submission_id}/reject")
async def reject_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FigureSubmission).where(FigureSubmission.id == submission_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status != "pending":
        raise HTTPException(status_code=400, detail=f"Submission already {sub.status}")

    sub.status = "rejected"
    sub.reviewed_at = datetime.now(timezone.utc)
    await db.commit()

    return {"status": "rejected", "message": "已拒絕此提交"}


# ── Error Reports ───────────────────────────────────────────────────

@router.get("/error-reports")
async def list_error_reports(
    status: str = Query("pending", description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    query = select(ErrorReport).order_by(ErrorReport.created_at.desc())
    if status != "all":
        query = query.where(ErrorReport.status == status)
    # Hide editor applications from non-admin users
    if current_user.role != "admin":
        query = query.where(ErrorReport.report_type != "editor_application")
    query = query.offset(skip).limit(limit)

    count_query = select(func.count(ErrorReport.id))
    if status != "all":
        count_query = count_query.where(ErrorReport.status == status)
    if current_user.role != "admin":
        count_query = count_query.where(ErrorReport.report_type != "editor_application")
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    result = await db.execute(query)
    reports = result.scalars().all()

    items = []
    for r in reports:
        items.append({
            "id": r.id,
            "figure_id": r.figure_id,
            "report_type": r.report_type,
            "description": r.description,
            "contact": r.contact,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"items": items, "total": total}


@router.post("/error-reports/{report_id}/resolve")
async def resolve_error_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ErrorReport).where(ErrorReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    report.status = "resolved"
    report.reviewed_at = datetime.now(timezone.utc)
    
    # Also resolve duplicate reports for the same listing
    import re as _re
    _m = _re.search(r"Listing #(\d+)", report.description or "")
    if _m:
        _dups = await db.execute(
            select(ErrorReport).where(
                ErrorReport.id != report.id,
                ErrorReport.status == "pending",
                ErrorReport.description.contains(f"Listing #{_m.group(1)} "),
            )
        )
        for _d in _dups.scalars().all():
            _d.status = "resolved"
            _d.reviewed_at = datetime.now(timezone.utc)
    
    await db.commit()
    return {"status": "resolved"}


@router.post("/error-reports/{report_id}/dismiss")
async def dismiss_error_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ErrorReport).where(ErrorReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    report.status = "dismissed"
    report.reviewed_at = datetime.now(timezone.utc)
    
    # Also dismiss duplicate reports for the same listing
    import re as _re2
    _m2 = _re2.search(r"Listing #(\d+)", report.description or "")
    if _m2:
        _dups2 = await db.execute(
            select(ErrorReport).where(
                ErrorReport.id != report.id,
                ErrorReport.status == "pending",
                ErrorReport.description.contains(f"Listing #{_m2.group(1)} "),
            )
        )
        for _d2 in _dups2.scalars().all():
            _d2.status = "dismissed"
            _d2.reviewed_at = datetime.now(timezone.utc)
    
    await db.commit()
    return {"status": "dismissed"}


# ── User Price Reports ──────────────────────────────────────────────

@router.get("/price-reports")
async def list_price_reports(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(select(func.count(UserReport.id)))
    total = count_result.scalar() or 0

    result = await db.execute(
        select(UserReport, Figure.name)
        .outerjoin(Figure, UserReport.figure_id == Figure.id)
        .order_by(UserReport.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = result.all()

    # Build source_id lookup for listing association
    items = []
    for report, fig_name in rows:
        # Find associated listing
        source_pattern = f"ur_{report.id}_{report.figure_id}"
        listing_result = await db.execute(
            select(Listing.id).where(
                Listing.source == "user_report",
                Listing.source_id == source_pattern,
            )
        )
        assoc_listing_id = listing_result.scalar_one_or_none()

        items.append({
            "id": report.id,
            "figure_id": report.figure_id,
            "figure_name": fig_name,
            "price": report.price,
            "currency": report.currency,
            "condition": report.condition,
            "platform": report.platform,
            "notes": report.notes,
            "listing_id": assoc_listing_id,
            "created_at": report.created_at.isoformat() if report.created_at else None,
        })

    return {"items": items, "total": total}


# ── Dashboard Stats ─────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
):
    """Quick stats for admin dashboard."""
    figures_count = (await db.execute(select(func.count(Figure.id)))).scalar() or 0
    listings_count = (await db.execute(select(func.count(Listing.id)))).scalar() or 0
    snapshots_count = (await db.execute(select(func.count(PriceSnapshot.id)))).scalar() or 0
    pending_submissions = (await db.execute(
        select(func.count(FigureSubmission.id)).where(FigureSubmission.status == "pending")
    )).scalar() or 0
    pending_errors = (await db.execute(
        select(func.count(ErrorReport.id)).where(ErrorReport.status == "pending")
    )).scalar() or 0
    total_reports = (await db.execute(select(func.count(UserReport.id)))).scalar() or 0

    # Figures with prices
    figures_with_price = (await db.execute(
        select(func.count(func.distinct(PriceSnapshot.figure_id)))
    )).scalar() or 0

    # Views today
    from sqlalchemy import text as sql_text
    from datetime import datetime, timezone
    # Taiwan timezone (UTC+8)
    tw_tz = timezone(timedelta(hours=8))
    today_start = datetime.now(tw_tz).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        views_today = (await db.execute(
            sql_text("SELECT COUNT(*) FROM page_views WHERE viewed_at >= :since"),
            {"since": today_start}
        )).scalar() or 0
    except Exception:
        views_today = 0

    total_views_result = await db.execute(
        sql_text("SELECT COALESCE(SUM(view_count), 0) FROM figures")
    )
    total_views = total_views_result.scalar() or 0

    return {
        "figures": figures_count,
        "figures_with_price": figures_with_price,
        "listings": listings_count,
        "snapshots": snapshots_count,
        "pending_submissions": pending_submissions,
        "pending_errors": pending_errors,
        "total_reports": total_reports,
        "views_today": views_today,
        "total_views": total_views,
    }


# ---------------------------------------------------------------------------
# CRUD: Edit submission before approve
# ---------------------------------------------------------------------------
@router.put("/submissions/{submission_id}")
async def update_submission(
    submission_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update a submission fields (admin)."""
    result = await db.execute(select(FigureSubmission).where(FigureSubmission.id == submission_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    
    allowed = ["name", "original_name", "character_name", "franchise_name", "manufacturer",
               "version_name", "series", "scale", "jan_code", "image_url", "notes",
               "retail_price", "retail_currency", "figure_type", "age_rating", "material", "sculptor",
               "painter", "dimensions", "gender", "release_date"]
    for key in allowed:
        if key in body:
            val = body[key]
            # Type conversions
            if key == "retail_price" and val is not None:
                try:
                    val = int(val) if val != "" else None
                except (ValueError, TypeError):
                    val = None
            elif val == "":
                val = None
            setattr(sub, key, val)
    await db.commit()
    return {"status": "updated"}


# ---------------------------------------------------------------------------
# CRUD: Figure management
# ---------------------------------------------------------------------------
@router.get("/figures-below-threshold")
async def list_below_threshold(
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List figures below the price threshold (~NT,000)."""
    result = await db.execute(
        select(Figure)
        .where(
            Figure.retail_price.isnot(None),
            Figure.retail_price > 0,
            or_(
                and_(Figure.retail_currency.in_(["JPY", None]), Figure.retail_price < 3700),
                and_(Figure.retail_currency == "CNY", Figure.retail_price < 180),
                and_(Figure.retail_currency == "USD", Figure.retail_price < 25),
                and_(Figure.retail_currency == "TWD", Figure.retail_price < 800),
            )
        )
        .order_by(Figure.retail_price.asc())
        .limit(limit)
    )
    items = []
    for f in result.scalars().all():
        items.append({
            "id": f.id, "name": f.name, "retail_price": f.retail_price,
            "retail_currency": f.retail_currency or "JPY", "manufacturer": f.manufacturer,
            "figure_type": f.figure_type, "image_url": f.image_url,
        })
    return {"items": items, "total": len(items)}


@router.get("/figures/{figure_id}")
async def admin_get_figure(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get full figure data for editing."""
    result = await db.execute(
        select(Figure, func.coalesce(Character.name, "").label("char_name"), Franchise.name.label("fran_name"))
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Character.franchise_id == Franchise.id)
        .where(Figure.id == figure_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Figure not found")
    fig = row[0]
    char_name = row[1] or ""
    fran_name = row[2] or ""
    return {
        "id": fig.id, "name": fig.name, "original_name": fig.original_name,
        "manufacturer": fig.manufacturer, "scale": fig.scale,
        "retail_price": fig.retail_price, "retail_currency": fig.retail_currency or "JPY", "image_url": fig.image_url,
        "sculptor": fig.sculptor, "painter": fig.painter,
        "dimensions": fig.dimensions, "material": fig.material,
        "gender": fig.gender, "figure_type": fig.figure_type,
        "age_rating": fig.age_rating, "release_date": fig.release_date,
        "reissue_dates": fig.reissue_dates, "character_id": fig.character_id,
        "source_id": fig.source_id, "series": fig.series,
        "version_name": fig.version_name, "jan_code": fig.jan_code,
        "character_name": char_name, "franchise_name": fran_name,
    }


@router.put("/figures/{figure_id}")
async def admin_update_figure(
    figure_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update figure fields (admin)."""
    result = await db.execute(select(Figure).where(Figure.id == figure_id))
    fig = result.scalar_one_or_none()
    if not fig:
        raise HTTPException(status_code=404, detail="Figure not found")
    
    # Handle character/franchise reassignment
    if "character_name" in body and "franchise_name" in body:
        franchise_name = body["franchise_name"]
        character_name = body["character_name"]
        if franchise_name and character_name:
            # Find or create franchise
            fr = await db.execute(select(Franchise).where(Franchise.name == franchise_name))
            franchise = fr.scalar_one_or_none()
            if not franchise:
                franchise = Franchise(name=franchise_name)
                db.add(franchise)
                await db.flush()
            # Find or create character
            ch = await db.execute(select(Character).where(
                Character.name == character_name, Character.franchise_id == franchise.id
            ))
            character = ch.scalar_one_or_none()
            if not character:
                character = Character(name=character_name, franchise_id=franchise.id)
                db.add(character)
                await db.flush()
            fig.character_id = character.id

    allowed = ["name", "original_name", "manufacturer", "scale", "retail_price",
               "retail_currency", "image_url", "sculptor", "painter", "dimensions",
               "material", "gender", "figure_type", "age_rating", "release_date",
               "reissue_dates", "series", "version_name", "jan_code", "source_id"]
    for key in allowed:
        if key in body:
            val = body[key]
            if key == "retail_price" and val is not None:
                try:
                    val = int(val) if val != "" else None
                except (ValueError, TypeError):
                    val = None
            elif val == "":
                val = None
            setattr(fig, key, val)
    await db.commit()
    return {"status": "updated"}


@router.delete("/figures/{figure_id}")
async def admin_delete_figure(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
    _admin = Depends(require_admin),
):
    """Delete a figure and its listings/snapshots (admin)."""
    result = await db.execute(select(Figure).where(Figure.id == figure_id))
    fig = result.scalar_one_or_none()
    if not fig:
        raise HTTPException(status_code=404, detail="Figure not found")
    
    await db.execute(select(Listing).where(Listing.figure_id == figure_id))
    from sqlalchemy import delete
    await db.execute(delete(Listing).where(Listing.figure_id == figure_id))
    await db.execute(delete(PriceSnapshot).where(PriceSnapshot.figure_id == figure_id))
    await db.execute(delete(UserReport).where(UserReport.figure_id == figure_id))
    await db.delete(fig)
    await db.commit()
    return {"status": "deleted"}


@router.post("/figures")
async def admin_create_figure(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Create a new figure (admin)."""
    fig = Figure(
        name=body.get("name", ""),
        original_name=body.get("original_name"),
        manufacturer=body.get("manufacturer"),
        scale=body.get("scale"),
        retail_price=body.get("retail_price"),
        image_url=body.get("image_url"),
        sculptor=body.get("sculptor"),
        painter=body.get("painter"),
        dimensions=body.get("dimensions"),
        material=body.get("material"),
        gender=body.get("gender"),
        figure_type=body.get("figure_type"),
        age_rating=body.get("age_rating"),
        release_date=body.get("release_date"),
        character_id=body.get("character_id"),
        series=body.get("series"),
    )
    db.add(fig)
    await db.commit()
    await db.refresh(fig)
    return {"status": "created", "id": fig.id}


# ---------------------------------------------------------------------------
# CRUD: Price report management
# ---------------------------------------------------------------------------
@router.delete("/price-reports/{report_id}")
async def admin_delete_price_report(
    report_id: int,
    listing_id: int | None = Query(None, description="Also delete this listing"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a price report and optionally its associated listing."""
    result = await db.execute(select(UserReport).where(UserReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    # Auto-find and delete associated listing
    # Try new format first: ur_{report_id}_{figure_id}
    source_id_pattern = f"ur_{report_id}_{report.figure_id}"
    listing_result = await db.execute(
        select(Listing).where(
            Listing.source == "user_report",
            Listing.source_id == source_id_pattern,
        )
    )
    assoc_listing = listing_result.scalar_one_or_none()
    
    # Fallback: try old format ur_0_{figure_id} or match by figure_id + similar timestamp
    if not assoc_listing:
        old_pattern = f"ur_0_{report.figure_id}"
        listing_result2 = await db.execute(
            select(Listing).where(
                Listing.source == "user_report",
                Listing.source_id.like(f"ur_0_{report.figure_id}%"),
                Listing.figure_id == report.figure_id,
            )
        )
        assoc_listing = listing_result2.scalars().first()
    if assoc_listing:
        await db.delete(assoc_listing)
    
    # Also delete explicitly requested listing
    if listing_id is not None and (not assoc_listing or assoc_listing.id != listing_id):
        extra_listing = await db.execute(select(Listing).where(Listing.id == listing_id))
        extra = extra_listing.scalar_one_or_none()
        if extra:
            await db.delete(extra)
    
    await db.delete(report)
    await db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# CRUD: Listing management
# ---------------------------------------------------------------------------
@router.delete("/listings/{listing_id}")
async def admin_delete_listing(
    listing_id: int,
    db: AsyncSession = Depends(get_db),
    _admin = Depends(require_admin),
):
    """Delete a listing and its associated user_report + error reports (admin)."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    # Delete any error reports that reference this listing
    error_pattern = f"Listing #{listing_id}"
    error_reports = await db.execute(
        select(ErrorReport).where(ErrorReport.description.contains(error_pattern))
    )
    for er in error_reports.scalars().all():
        await db.delete(er)
    
    # If this listing came from a user report, also delete the report
    if listing.source == "user_report" and listing.source_id:
        import re as _re
        m = _re.match(r"ur_(\d+)_", listing.source_id)
        if m:
            report_id = int(m.group(1))
            report_result = await db.execute(select(UserReport).where(UserReport.id == report_id))
            report = report_result.scalar_one_or_none()
            if report:
                await db.delete(report)
    
    figure_id_for_refresh = listing.figure_id
    await db.delete(listing)
    await db.commit()

    # Recalculate snapshots for this figure after deletion
    if figure_id_for_refresh:
        try:
            await recalculate_figure_snapshots(figure_id_for_refresh, db)
            await db.commit()
        except Exception:
            pass

    return {"status": "deleted"}


@router.post("/listings")
async def admin_create_listing(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Manually create a listing (admin)."""
    RATES_TO_USD = {"JPY": 1/149.5, "TWD": 1/32.2, "USD": 1, "CNY": 1/7.25}
    currency = body.get("currency", "JPY")
    price = float(body.get("price", 0))
    price_usd = price * RATES_TO_USD.get(currency, 1)
    
    listing = Listing(
        figure_id=body.get("figure_id"),
        source=body.get("source", "manual"),
        source_id=body.get("source_id"),
        title=body.get("title", ""),
        price=price,
        currency=currency,
        price_usd=round(price_usd, 2),
        condition=body.get("condition", "used"),
        is_sold=body.get("is_sold", True),
        url=body.get("url"),
        image_url=body.get("image_url"),
    )
    db.add(listing)
    await db.commit()
    return {"status": "created", "id": listing.id}


# ---------------------------------------------------------------------------
# Search/list ALL figures with pagination
# ---------------------------------------------------------------------------
@router.get("/figures")
async def admin_list_figures(
    q: str = Query("", description="Search by name/manufacturer"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Search/list all figures with pagination."""
    from sqlalchemy import or_

    base = select(Figure)
    count_base = select(func.count(Figure.id))

    if q.strip():
        pattern = f"%{q.strip()}%"
        filt = or_(
            Figure.name.ilike(pattern),
            Figure.original_name.ilike(pattern),
            Figure.manufacturer.ilike(pattern),
            Figure.series.ilike(pattern),
        )
        base = base.where(filt)
        count_base = count_base.where(filt)

    total = (await db.execute(count_base)).scalar() or 0

    result = await db.execute(
        base.order_by(Figure.id.desc()).offset(skip).limit(limit)
    )
    figures = result.scalars().all()

    items = []
    for f in figures:
        items.append({
            "id": f.id,
            "name": f.name,
            "original_name": f.original_name,
            "manufacturer": f.manufacturer,
            "scale": f.scale,
            "series": f.series,
            "image_url": f.image_url,
            "figure_type": f.figure_type,
            "release_date": f.release_date,
            "character_id": f.character_id,
            "retail_price": f.retail_price,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        })

    return {"items": items, "total": total}


# ---------------------------------------------------------------------------
# List listings for a specific figure
# ---------------------------------------------------------------------------
@router.get("/figures/{figure_id}/listings")
async def admin_figure_listings(
    figure_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all listings for a specific figure."""
    # Verify figure exists
    fig_result = await db.execute(select(Figure.id).where(Figure.id == figure_id))
    if not fig_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Figure not found")

    count_result = await db.execute(
        select(func.count(Listing.id)).where(Listing.figure_id == figure_id)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(Listing)
        .where(Listing.figure_id == figure_id)
        .order_by(Listing.scraped_at.desc())
        .offset(skip)
        .limit(limit)
    )
    listings = result.scalars().all()

    items = []
    for l in listings:
        items.append({
            "id": l.id,
            "figure_id": l.figure_id,
            "source": l.source,
            "source_id": l.source_id,
            "title": l.title,
            "price": l.price,
            "currency": l.currency,
            "price_usd": l.price_usd,
            "condition": l.condition,
            "is_sold": l.is_sold,
            "url": l.url,
            "image_url": l.image_url,
            "listed_at": l.listed_at.isoformat() if l.listed_at else None,
            "sold_at": l.sold_at.isoformat() if l.sold_at else None,
            "scraped_at": l.scraped_at.isoformat() if l.scraped_at else None,
        })

    return {"items": items, "total": total}


# ---------------------------------------------------------------------------
# Edit a listing
# ---------------------------------------------------------------------------
@router.put("/listings/{listing_id}")
async def admin_update_listing(
    listing_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update listing fields (admin)."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    allowed = ["figure_id", "source", "source_id", "title", "price", "currency",
               "price_usd", "condition", "is_sold", "url", "image_url", "sold_at"]
    for key in allowed:
        if key in body:
            val = body[key]
            if key == "sold_at" and val:
                try:
                    from datetime import datetime as _dt
                    val = _dt.fromisoformat(val) if isinstance(val, str) else val
                except (ValueError, TypeError):
                    val = None
            elif key == "price" and val is not None:
                try:
                    val = int(val) if val != "" else None
                except (ValueError, TypeError):
                    val = None
            setattr(listing, key, val)
    await db.commit()
    return {"status": "updated"}



# ---------------------------------------------------------------------------
# Site Config
# ---------------------------------------------------------------------------
@router.get("/config")
async def get_site_config(db: AsyncSession = Depends(get_db)):
    """Get all site config entries."""
    from sqlalchemy import text as sql_text
    result = await db.execute(sql_text("SELECT key, value FROM site_config ORDER BY key"))
    return {row.key: row.value for row in result.all()}

@router.put("/config/{key}")
async def set_site_config(key: str, body: dict, db: AsyncSession = Depends(get_db), _admin = Depends(require_admin)):
    """Set a site config value."""
    from sqlalchemy import text as sql_text
    value = body.get("value", "")
    await db.execute(
        sql_text("INSERT INTO site_config (key, value, updated_at) VALUES (:k, :v, NOW()) ON CONFLICT (key) DO UPDATE SET value = :v, updated_at = NOW()"),
        {"k": key, "v": value}
    )
    await db.commit()
    return {"status": "updated"}



# ── Figure Notes Management ─────────────────────────────────────

@router.get("/notes")
async def admin_list_notes(
    status: str = Query("all", description="Filter: all, visible, hidden, reported"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List figure notes for admin review."""
    from sqlalchemy import text as sql_text
    where = ""
    if status == "visible": where = "AND fn.status = 'visible'"
    elif status == "hidden": where = "AND fn.status = 'hidden'"
    elif status == "reported": where = "AND fn.report_count > 0"
    
    result = await db.execute(sql_text(f"""
        SELECT fn.id, fn.figure_id, f.name as figure_name, fn.content, fn.link_url, 
               fn.status, fn.report_count, fn.created_at
        FROM figure_notes fn
        JOIN figures f ON fn.figure_id = f.id
        WHERE 1=1 {where}
        ORDER BY fn.report_count DESC, fn.created_at DESC
        LIMIT :lim
    """), {"lim": limit})
    
    return [{
        "id": r[0], "figure_id": r[1], "figure_name": r[2], "content": r[3],
        "link_url": r[4], "status": r[5], "report_count": r[6],
        "created_at": r[7].isoformat() if r[7] else None,
    } for r in result.all()]


@router.delete("/notes/{note_id}")
async def admin_delete_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    _admin = Depends(require_admin),
):
    """Delete a note (admin). Also resolves related error reports."""
    from sqlalchemy import text as sql_text
    # Auto-resolve any error reports referencing this note
    await db.execute(
        sql_text("UPDATE error_reports SET status = 'resolved', reviewed_at = NOW() WHERE report_type = 'note_abuse' AND description LIKE :pattern AND status = 'pending'"),
        {"pattern": f"Note #{note_id} %"}
    )
    await db.execute(sql_text("DELETE FROM figure_notes WHERE id = :nid"), {"nid": note_id})
    await db.commit()
    return {"status": "deleted"}
