from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin
from db.database import get_db
from db.models import ErrorReport, Figure, Character, Franchise
from schemas import ErrorReportIn, ErrorReportOut

router = APIRouter(tags=["reports"])


@router.post("/reports", response_model=ErrorReportOut)
async def submit_report(
    report: ErrorReportIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ErrorReportOut:
    """Submit an error report (public, rate limited)."""
    # Rate limit: 10 reports per IP per hour
    import redis.asyncio as aioredis, os
    try:
        r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        ip = request.client.host if request.client else "unknown"
        key = f"error_reports:{ip}"
        attempts = await r.incr(key)
        if attempts == 1: await r.expire(key, 3600)
        await r.aclose()
        if attempts > 10:
            raise HTTPException(status_code=429, detail="Too many reports. Try again later.")
    except HTTPException: raise
    except Exception: pass

    er = ErrorReport(
        figure_id=report.figure_id,
        report_type=report.report_type,
        description=report.description,
        contact=report.contact,
        status="pending",
    )
    db.add(er)
    await db.commit()
    await db.refresh(er)
    return ErrorReportOut.model_validate(er)


@router.get("/admin/reports", response_model=list[ErrorReportOut])
async def list_reports(
    status: str = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[ErrorReportOut]:
    """List error reports (admin only)."""
    query = select(ErrorReport)
    if status != "all":
        query = query.where(ErrorReport.status == status)
    query = query.order_by(ErrorReport.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return [ErrorReportOut.model_validate(r) for r in result.scalars().all()]


@router.post("/admin/reports/{report_id}/resolve")
async def resolve_report(
    report_id: int,
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark a report as resolved (admin only)."""
    result = await db.execute(select(ErrorReport).where(ErrorReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = "resolved"
    report.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "resolved"}


@router.get("/admin/stats")
async def admin_stats(
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get database stats (admin only)."""
    figures = (await db.execute(select(func.count(Figure.id)))).scalar() or 0
    enriched = (await db.execute(
        select(func.count(Figure.id)).where(Figure.image_url.isnot(None))
    )).scalar() or 0
    franchises = (await db.execute(select(func.count(Franchise.id)))).scalar() or 0
    characters = (await db.execute(select(func.count(Character.id)))).scalar() or 0
    pending_reports = (await db.execute(
        select(func.count(ErrorReport.id)).where(ErrorReport.status == "pending")
    )).scalar() or 0
    return {
        "figures": figures,
        "enriched": enriched,
        "franchises": franchises,
        "characters": characters,
        "pending_reports": pending_reports,
    }
