from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from auth import require_editor, require_admin, get_current_user
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Character, ErrorReport, Figure, FigureSubmission, Franchise, Listing, PriceSnapshot, UserReport
from routers.figures import recalculate_figure_snapshots
from schemas import (
    AdminFigureUpdate,
    AdminFigureBatchUpdate,
    AdminFigureBatchUpdateCharacter,
    AdminFigureBatchUpdateFranchise,
    AdminListingUpdate,
    AdminListingCreate,
    AdminSubmissionUpdate,
    ErrorReportOut,
    FigureSubmissionOut,
)

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
            "illustrator": s.illustrator,
            "dimensions": s.dimensions,
            "gender": s.gender,
            "release_date": s.release_date,
            "official_url": s.official_url,
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
        franchise_id = placeholder_fran.id  # so Figure.franchise_id below gets the right value
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
        franchise_id=franchise_id,  # mirror character's franchise so figure.franchise_id is populated for new approvals
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
        illustrator=sub.illustrator,
        dimensions=sub.dimensions,
        gender=sub.gender,
        release_date=sub.release_date,
        release_year=release_year,
        hpoi_link=sub.hpoi_link,
        official_url=sub.official_url,
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


# ── Scraper Health ──────────────────────────────────────────────────

@router.get("/scraper-health")
async def get_scraper_health(db: AsyncSession = Depends(get_db)):
    """Per-source ingestion health so silent scraper outages are visible.

    Returns one row per `listings.source` with: total count, last scrape time,
    counts in the trailing 24h and 7d windows, and the count of suspicious
    flags in the last 7d (proxy for matching quality)."""
    from sqlalchemy import text as sql_text

    rows = (await db.execute(sql_text("""
        SELECT
          l.source,
          COUNT(*) AS total,
          MAX(l.scraped_at) AS last_scraped_at,
          COUNT(*) FILTER (WHERE l.scraped_at >= NOW() - INTERVAL '24 hours') AS last_24h,
          COUNT(*) FILTER (WHERE l.scraped_at >= NOW() - INTERVAL '7 days') AS last_7d
        FROM listings l
        GROUP BY l.source
        ORDER BY last_scraped_at DESC NULLS LAST
    """))).all()

    suspicious_7d = (await db.execute(sql_text("""
        SELECT COUNT(*) FROM error_reports
        WHERE report_type = 'suspicious_listing'
          AND created_at >= NOW() - INTERVAL '7 days'
    """))).scalar() or 0

    return {
        "sources": [
            {
                "source": r[0],
                "total": int(r[1] or 0),
                "last_scraped_at": r[2].isoformat() if r[2] else None,
                "last_24h": int(r[3] or 0),
                "last_7d": int(r[4] or 0),
            }
            for r in rows
        ],
        "suspicious_flags_7d": int(suspicious_7d),
    }


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
    body: AdminSubmissionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a submission fields (admin)."""
    result = await db.execute(select(FigureSubmission).where(FigureSubmission.id == submission_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    for key, val in body.model_dump(exclude_unset=True).items():
        if val == "":
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
    # Franchise via figure.franchise_id (denormalised) so admin sees what they
    # actually batch-edited rather than the character's intrinsic franchise.
    result = await db.execute(
        select(Figure, func.coalesce(Character.name, "").label("char_name"), Franchise.name.label("fran_name"))
        .outerjoin(Character, Figure.character_id == Character.id)
        .outerjoin(Franchise, Figure.franchise_id == Franchise.id)
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
        "illustrator": fig.illustrator,
        "dimensions": fig.dimensions, "material": fig.material,
        "gender": fig.gender, "figure_type": fig.figure_type,
        "age_rating": fig.age_rating, "release_date": fig.release_date,
        "reissue_dates": fig.reissue_dates, "character_id": fig.character_id,
        "source_id": fig.source_id, "series": fig.series,
        "version_name": fig.version_name, "jan_code": fig.jan_code,
        "official_url": fig.official_url,
        "character_name": char_name, "franchise_name": fran_name,
    }


@router.put("/figures/{figure_id}")
async def admin_update_figure(
    figure_id: int,
    body: AdminFigureUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update figure fields (admin). Note: `jan_code` and `source_id` are NOT editable
    to avoid breaking scraper idempotency; only set via approve/create flows."""
    result = await db.execute(select(Figure).where(Figure.id == figure_id))
    fig = result.scalar_one_or_none()
    if not fig:
        raise HTTPException(status_code=404, detail="Figure not found")

    data = body.model_dump(exclude_unset=True)

    # Handle character/franchise — now independent thanks to figure.franchise_id
    # (denormalised). Editor can set franchise alone (rest stays put) or set
    # character alone (we use the figure's current franchise for find-or-create).
    character_name = data.pop("character_name", None)
    franchise_name = data.pop("franchise_name", None)

    # 1) Franchise: find-or-create + set fig.franchise_id directly. Independent
    #    of character — this is the editor-meaningful field for display.
    target_franchise = None
    if franchise_name:
        fr = await db.execute(select(Franchise).where(Franchise.name == franchise_name))
        target_franchise = fr.scalar_one_or_none()
        if not target_franchise:
            target_franchise = Franchise(name=franchise_name)
            db.add(target_franchise)
            await db.flush()
        fig.franchise_id = target_franchise.id

    # 2) Character: find-or-create scoped to the *intended* franchise — which is
    #    (a) the franchise the editor just set, or (b) the figure's existing
    #    franchise. Skip if no franchise context available.
    if character_name:
        scope_franchise_id = (
            target_franchise.id if target_franchise else fig.franchise_id
        )
        if scope_franchise_id is not None:
            ch = await db.execute(select(Character).where(
                Character.name == character_name, Character.franchise_id == scope_franchise_id
            ))
            character = ch.scalar_one_or_none()
            if not character:
                character = Character(name=character_name, franchise_id=scope_franchise_id)
                db.add(character)
                await db.flush()
            fig.character_id = character.id

    # Apply the remaining scalar fields. Pydantic already validated types/lengths/URL scheme.
    for key, val in data.items():
        if val == "":
            val = None
        setattr(fig, key, val)
    await db.commit()
    return {"status": "updated"}


@router.post("/figures/batch-update")
async def admin_batch_update_figures(
    body: AdminFigureBatchUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Set ONE whitelisted field to the same value across many figures at once
    (admin 公仔管理 batch edit). Editor-level, same as single-figure edit. The
    field is constrained to a safe whitelist by AdminFigureBatchUpdate; the
    value is re-validated against the real per-field rule (e.g. scale max 50)."""
    # Reuse the exact per-field constraint from the single-edit schema.
    try:
        AdminFigureUpdate.model_validate({body.field: body.value})
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"invalid value for {body.field}: {e}")

    value = body.value if body.value not in (None, "") else None
    from sqlalchemy import update as sql_update
    result = await db.execute(
        sql_update(Figure).where(Figure.id.in_(body.ids)).values({body.field: value})
    )
    await db.commit()
    return {"updated": result.rowcount}


@router.post("/figures/batch-update-franchise")
async def admin_batch_update_franchise(
    body: AdminFigureBatchUpdateFranchise,
    db: AsyncSession = Depends(get_db),
):
    """Batch-set the franchise of N figures (independent of character).
    Find-or-create the named franchise, then UPDATE figures.franchise_id.
    Does NOT touch character_id — that's a separate batch endpoint."""
    from sqlalchemy import update as sql_update
    fr_res = await db.execute(select(Franchise).where(Franchise.name == body.franchise_name))
    franchise = fr_res.scalar_one_or_none()
    franchise_created = False
    if not franchise:
        franchise = Franchise(name=body.franchise_name)
        db.add(franchise)
        await db.flush()
        franchise_created = True
    upd = await db.execute(
        sql_update(Figure).where(Figure.id.in_(body.ids)).values(franchise_id=franchise.id)
    )
    await db.commit()
    return {
        "updated": upd.rowcount,
        "franchise_id": franchise.id,
        "franchise_created": franchise_created,
    }


@router.post("/figures/batch-update-character")
async def admin_batch_update_character(
    body: AdminFigureBatchUpdateCharacter,
    db: AsyncSession = Depends(get_db),
):
    """Batch-set the character of N figures (independent of franchise).
    For each figure, the character is find-or-created scoped to the figure's
    CURRENT franchise (figure.franchise_id). Figures with no franchise are
    skipped — set their franchise first via /batch-update-franchise.

    Why per-figure scoping: a character belongs to exactly one franchise in
    our schema, so two figures with different franchises can't share the same
    character entity. By scoping to each figure's existing franchise we get
    the right character (existing or created) under the right parent."""
    from sqlalchemy import update as sql_update
    figs_res = await db.execute(
        select(Figure.id, Figure.franchise_id).where(Figure.id.in_(body.ids))
    )
    rows = figs_res.all()
    # Bucket figures by their franchise_id so we look up / create characters once per franchise.
    by_franchise: dict[int, list[int]] = {}
    skipped: list[int] = []
    for fid, fr_id in rows:
        if fr_id is None:
            skipped.append(fid)
        else:
            by_franchise.setdefault(fr_id, []).append(fid)

    updated = 0
    characters_created = 0
    for fr_id, fids in by_franchise.items():
        ch_res = await db.execute(
            select(Character).where(
                Character.name == body.character_name,
                Character.franchise_id == fr_id,
            )
        )
        character = ch_res.scalar_one_or_none()
        if not character:
            character = Character(name=body.character_name, franchise_id=fr_id)
            db.add(character)
            await db.flush()
            characters_created += 1
        res = await db.execute(
            sql_update(Figure).where(Figure.id.in_(fids)).values(character_id=character.id)
        )
        updated += res.rowcount
    await db.commit()
    return {
        "updated": updated,
        "skipped_no_franchise": len(skipped),
        "characters_created": characters_created,
    }


@router.delete("/figures/{figure_id}")
async def admin_delete_figure(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
    _admin = Depends(require_admin),
):
    """Delete a figure and ALL its dependent rows (admin).
    Explicitly deletes from every table that references figures.id so the final
    figure DELETE doesn't fail on RESTRICT foreign keys."""
    result = await db.execute(select(Figure).where(Figure.id == figure_id))
    fig = result.scalar_one_or_none()
    if not fig:
        raise HTTPException(status_code=404, detail="Figure not found")

    from sqlalchemy import delete, text as sql_text
    # Core price data
    await db.execute(delete(Listing).where(Listing.figure_id == figure_id))
    await db.execute(delete(PriceSnapshot).where(PriceSnapshot.figure_id == figure_id))
    await db.execute(delete(UserReport).where(UserReport.figure_id == figure_id))
    # Engagement/user data — tables may or may not exist; wrap each in a
    # SAVEPOINT so a missing-table/column error rolls back only that one
    # statement, not the whole transaction. (Without the savepoint, the first
    # failing DELETE poisons the entire transaction and the final db.commit
    # of the figure delete blows up with "transaction is aborted".)
    import logging as _log
    for stmt, label in [
        ("DELETE FROM user_watchlist WHERE figure_id = :fid", "watchlist"),
        ("DELETE FROM user_purchases WHERE figure_id = :fid", "purchases"),
        ("DELETE FROM figure_notes WHERE figure_id = :fid", "notes"),
        ("DELETE FROM figure_note_reports WHERE note_id IN (SELECT id FROM figure_notes WHERE figure_id = :fid)", "note_reports"),
        ("DELETE FROM figure_ratings WHERE figure_id = :fid", "ratings"),
        ("DELETE FROM error_reports WHERE figure_id = :fid", "error_reports"),
        ("DELETE FROM orders WHERE figure_id = :fid", "orders"),
        ("DELETE FROM transactions WHERE figure_id = :fid", "transactions"),
        ("DELETE FROM page_views WHERE figure_id = :fid", "page_views"),
        ("DELETE FROM figure_submissions WHERE figure_id = :fid", "submissions"),
    ]:
        try:
            async with db.begin_nested():
                await db.execute(sql_text(stmt), {"fid": figure_id})
        except Exception as e:
            _log.getLogger(__name__).info("admin_delete_figure: skipping %s (%s)", label, e)
    await db.delete(fig)
    await db.commit()
    return {"status": "deleted"}


@router.post("/figures")
async def admin_create_figure(
    body: AdminFigureUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new figure (admin). Uses the same validated model as update."""
    data = body.model_dump(exclude_unset=True)
    if not data.get("name"):
        raise HTTPException(status_code=422, detail="name is required")
    # character_name/franchise_name not supported in create; use update after
    data.pop("character_name", None)
    data.pop("franchise_name", None)
    fig = Figure(**{k: v for k, v in data.items() if v != ""})
    db.add(fig)
    await db.flush()
    # If character_id was provided, mirror its franchise onto figure.franchise_id
    # so the denormalised column is consistent from row one (avoids NULL franchise
    # display on freshly-created figures).
    if fig.character_id and fig.franchise_id is None:
        ch_res = await db.execute(select(Character.franchise_id).where(Character.id == fig.character_id))
        ch_fr = ch_res.scalar_one_or_none()
        if ch_fr:
            fig.franchise_id = ch_fr
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

    figure_id = report.figure_id
    await db.delete(report)
    await db.commit()
    # Recalculate snapshots so the removed report stops affecting price stats
    try:
        await recalculate_figure_snapshots(figure_id, db)
        await db.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Snapshot recalc failed for figure_id=%s", figure_id)
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
    body: AdminListingCreate,
    db: AsyncSession = Depends(get_db),
):
    """Manually create a listing (admin)."""
    # Verify figure exists
    target = await db.execute(select(Figure.id).where(Figure.id == body.figure_id))
    if not target.scalar_one_or_none():
        raise HTTPException(status_code=422, detail="Target figure_id does not exist")

    # `price_canonical` column is a legacy name; contents are the canonical TWD value.
    from currency import get_live_rates, to_display
    rates = await get_live_rates()
    canonical_twd = to_display(body.price, body.currency, "TWD", rates) or 0.0

    listing = Listing(
        figure_id=body.figure_id,
        source=body.source or "manual",
        source_id=body.source_id,
        title=body.title or "",
        price=body.price,
        currency=body.currency,
        price_canonical=round(canonical_twd, 2),
        condition=body.condition or "used",
        is_sold=body.is_sold,
        url=body.url,
        image_url=body.image_url,
        notes=body.notes,
    )
    db.add(listing)
    await db.commit()
    # Keep snapshots in sync
    try:
        await recalculate_figure_snapshots(body.figure_id, db)
        await db.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Snapshot recalc failed for figure_id=%s", body.figure_id)
    return {"status": "created", "id": listing.id}


# ---------------------------------------------------------------------------
# Search/list ALL figures with pagination
# ---------------------------------------------------------------------------
@router.get("/figures")
async def admin_list_figures(
    q: str = Query("", description="Search by name/manufacturer"),
    skip: int = Query(0, ge=0),
    # cap bumped 100→200 so the 公仔管理 multi-select can fit a whole product
    # line on one page (frontend asks for 150). 200 is also the batch-update id cap.
    limit: int = Query(20, ge=1, le=200),
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
            "price_canonical": l.price_canonical,
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
    body: AdminListingUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update listing fields (admin). Recalculates snapshots for any affected figures."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    old_figure_id = listing.figure_id
    data = body.model_dump(exclude_unset=True)

    # If figure_id is changing, confirm the target exists
    new_figure_id = data.get("figure_id")
    if new_figure_id is not None and new_figure_id != old_figure_id:
        target = await db.execute(select(Figure.id).where(Figure.id == new_figure_id))
        if not target.scalar_one_or_none():
            raise HTTPException(status_code=422, detail="Target figure_id does not exist")

    for key, val in data.items():
        if key == "sold_at" and val:
            try:
                from datetime import datetime as _dt
                val = _dt.fromisoformat(val) if isinstance(val, str) else val
            except (ValueError, TypeError):
                val = None
        elif val == "":
            val = None
        setattr(listing, key, val)

    # Re-derive the canonical value whenever price or currency changed, otherwise
    # the cached value drifts and snapshot recalc reads a stale figure.
    # (The column name "price_canonical" is legacy; contents are TWD.)
    if "price" in data or "currency" in data:
        from currency import get_live_rates, to_display
        rates = await get_live_rates()
        new_twd = to_display(listing.price, listing.currency, "TWD", rates)
        listing.price_canonical = round(new_twd, 2) if new_twd is not None else None

    await db.commit()

    # Recalculate snapshots for the affected figure(s)
    affected = {old_figure_id}
    if new_figure_id is not None and new_figure_id != old_figure_id:
        affected.add(new_figure_id)
    import logging
    _log = logging.getLogger(__name__)
    for fid in affected:
        if fid is None:
            continue
        try:
            await recalculate_figure_snapshots(fid, db)
        except Exception:
            _log.exception("Snapshot recalc failed for figure_id=%s", fid)
    await db.commit()
    return {"status": "updated"}



# ---------------------------------------------------------------------------
# Site Config
# ---------------------------------------------------------------------------
@router.get("/config")
async def get_site_config(
    db: AsyncSession = Depends(get_db),
    _admin = Depends(require_admin),
):
    """Get all site config entries. Admin-only to avoid leaking any secret-shaped values."""
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


# ── Franchise Management ─────────────────────────────────────────────

@router.get("/franchises")
async def list_franchises(
    q: str = Query("", description="Search by name or name_zh"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List franchises with figure counts, for admin rename UI."""
    # figure_count = figures whose Figure.franchise_id = franchise.id (denormalised
    # column, so editor batch-edits to a figure's franchise are reflected in the
    # admin franchise list immediately).
    fc_subq = (
        select(Figure.franchise_id.label("franchise_id"), func.count(Figure.id).label("fc"))
        .where(Figure.franchise_id.isnot(None))
        .group_by(Figure.franchise_id)
        .subquery()
    )
    stmt = (
        select(Franchise, func.coalesce(fc_subq.c.fc, 0).label("figure_count"))
        .outerjoin(fc_subq, Franchise.id == fc_subq.c.franchise_id)
    )
    count_stmt = select(func.count(Franchise.id))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Franchise.name.ilike(like), Franchise.name_zh.ilike(like)))
        count_stmt = count_stmt.where(or_(Franchise.name.ilike(like), Franchise.name_zh.ilike(like)))
    stmt = stmt.order_by(func.coalesce(fc_subq.c.fc, 0).desc(), Franchise.name.asc()).offset(skip).limit(limit)

    total = (await db.execute(count_stmt)).scalar() or 0
    rows = (await db.execute(stmt)).all()
    items = [
        {
            "id": fr.id,
            "name": fr.name,
            "name_zh": fr.name_zh,
            "figure_count": int(figure_count),
        }
        for fr, figure_count in rows
    ]
    return {"items": items, "total": total}


@router.put("/franchises/{franchise_id}")
async def update_franchise(
    franchise_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Rename a franchise globally (affects all linked figures)."""
    name = (body.get("name") or "").strip()
    name_zh = body.get("name_zh")
    if name_zh is not None:
        name_zh = name_zh.strip() or None

    if not name:
        raise HTTPException(status_code=400, detail="名稱不可為空")
    if len(name) > 300:
        raise HTTPException(status_code=400, detail="名稱過長（最多 300 字元）")

    result = await db.execute(select(Franchise).where(Franchise.id == franchise_id))
    fr = result.scalar_one_or_none()
    if not fr:
        raise HTTPException(status_code=404, detail="Franchise not found")

    # Check name collision (unique constraint)
    if name != fr.name:
        existing = await db.execute(
            select(Franchise.id).where(Franchise.name == name, Franchise.id != franchise_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="此名稱已被其他作品使用")

    fr.name = name
    fr.name_zh = name_zh
    await db.commit()
    return {"status": "updated", "id": fr.id, "name": fr.name, "name_zh": fr.name_zh}


# ── Character Management ─────────────────────────────────────────────

@router.get("/characters")
async def list_characters(
    q: str = Query("", description="Search by name or name_zh"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List characters with figure counts + franchise name."""
    fc_subq = (
        select(Figure.character_id, func.count(Figure.id).label("fc"))
        .group_by(Figure.character_id)
        .subquery()
    )
    stmt = (
        select(Character, Franchise.name.label("franchise_name"), func.coalesce(fc_subq.c.fc, 0).label("figure_count"))
        .outerjoin(Franchise, Character.franchise_id == Franchise.id)
        .outerjoin(fc_subq, Character.id == fc_subq.c.character_id)
    )
    count_stmt = select(func.count(Character.id))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Character.name.ilike(like), Character.name_zh.ilike(like)))
        count_stmt = count_stmt.where(or_(Character.name.ilike(like), Character.name_zh.ilike(like)))
    stmt = stmt.order_by(func.coalesce(fc_subq.c.fc, 0).desc(), Character.name.asc()).offset(skip).limit(limit)

    total = (await db.execute(count_stmt)).scalar() or 0
    rows = (await db.execute(stmt)).all()
    items = [
        {
            "id": c.id,
            "name": c.name,
            "name_zh": c.name_zh,
            "franchise_id": c.franchise_id,
            "franchise_name": franchise_name,
            "figure_count": int(figure_count),
        }
        for c, franchise_name, figure_count in rows
    ]
    return {"items": items, "total": total}


@router.put("/characters/{character_id}")
async def update_character(
    character_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Rename a character globally (affects all linked figures). Warns on name collision within same franchise."""
    name = (body.get("name") or "").strip()
    name_zh = body.get("name_zh")
    if name_zh is not None:
        name_zh = name_zh.strip() or None

    if not name:
        raise HTTPException(status_code=400, detail="名稱不可為空")
    if len(name) > 300:
        raise HTTPException(status_code=400, detail="名稱過長（最多 300 字元）")

    result = await db.execute(select(Character).where(Character.id == character_id))
    ch = result.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Character not found")

    # Soft warning if another character in same franchise already has this name
    warning = None
    if name != ch.name:
        dup = await db.execute(
            select(Character.id).where(
                Character.name == name,
                Character.franchise_id == ch.franchise_id,
                Character.id != character_id,
            )
        )
        if dup.scalar_one_or_none():
            warning = "同作品中已有相同名稱的角色"

    ch.name = name
    ch.name_zh = name_zh
    await db.commit()
    result = {"status": "updated", "id": ch.id, "name": ch.name, "name_zh": ch.name_zh}
    if warning:
        result["warning"] = warning
    return result
