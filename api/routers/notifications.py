"""Notification endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Notification, User
from auth import get_current_user as require_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's notifications, newest first."""
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    notifs = result.scalars().all()

    return [
        {
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "body": n.body,
            "data_json": n.data_json,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notifs
    ]


@router.get("/unread-count")
async def unread_count(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Count unread notifications for badge."""
    stmt = select(func.count()).select_from(Notification).where(
        and_(
            Notification.user_id == user.id,
            Notification.is_read == False,
        )
    )
    result = await db.execute(stmt)
    count = result.scalar_one()
    return {"unread_count": count}


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark one notification as read."""
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id)
    )
    notif = result.scalar_one_or_none()

    if not notif:
        raise HTTPException(status_code=404, detail="找不到該通知")
    if notif.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能標記自己的通知")

    notif.is_read = True
    await db.commit()

    return {"id": notif.id, "is_read": True}


@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    stmt = (
        update(Notification)
        .where(
            and_(
                Notification.user_id == user.id,
                Notification.is_read == False,
            )
        )
        .values(is_read=True)
    )
    result = await db.execute(stmt)
    await db.commit()

    return {"marked_read": result.rowcount}
