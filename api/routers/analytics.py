"""Page view tracking endpoints."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin
from db.database import get_db

router = APIRouter(tags=["analytics"])


class PageViewIn(BaseModel):
    page: str
    figure_id: int | None = None


@router.post("/track")
async def track_view(view: PageViewIn, db: AsyncSession = Depends(get_db)):
    """Track a page view (public, called from frontend)."""
    await db.execute(
        text("INSERT INTO page_views (page, figure_id) VALUES (:page, :fid)"),
        {"page": view.page, "fid": view.figure_id},
    )
    if view.figure_id:
        await db.execute(
            text("UPDATE figures SET view_count = COALESCE(view_count, 0) + 1 WHERE id = :id"),
            {"id": view.figure_id},
        )
    await db.commit()
    return {"status": "ok"}


@router.get("/admin/analytics")
async def get_analytics(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get site analytics (admin only)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Total views
    total = (await db.execute(
        text("SELECT COUNT(*) FROM page_views WHERE viewed_at >= :since"),
        {"since": since},
    )).scalar() or 0

    # Views per day
    daily = (await db.execute(
        text("""SELECT viewed_at::date as day, COUNT(*) as views
               FROM page_views WHERE viewed_at >= :since
               GROUP BY day ORDER BY day"""),
        {"since": since},
    )).all()

    # Top pages
    top_pages = (await db.execute(
        text("""SELECT page, COUNT(*) as views FROM page_views
               WHERE viewed_at >= :since GROUP BY page ORDER BY views DESC LIMIT 10"""),
        {"since": since},
    )).all()

    # Top figures
    top_figures = (await db.execute(
        text("""SELECT f.id, f.name, f.image_url, COUNT(pv.id) as views
               FROM page_views pv JOIN figures f ON pv.figure_id = f.id
               WHERE pv.viewed_at >= :since AND pv.figure_id IS NOT NULL
               GROUP BY f.id, f.name, f.image_url ORDER BY views DESC LIMIT 10"""),
        {"since": since},
    )).all()

    # Unique visitors (approximate by counting distinct hours)
    unique_approx = (await db.execute(
        text("""SELECT COUNT(DISTINCT date_trunc('hour', viewed_at)) FROM page_views
               WHERE viewed_at >= :since"""),
        {"since": since},
    )).scalar() or 0

    return {
        "total_views": total,
        "unique_hours": unique_approx,
        "daily": [{"day": str(r.day), "views": r.views} for r in daily],
        "top_pages": [{"page": r.page, "views": r.views} for r in top_pages],
        "top_figures": [{"id": r.id, "name": r.name, "image_url": r.image_url, "views": r.views} for r in top_figures],
    }
