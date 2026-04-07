"""Trading bulletin board — buy/sell posts per figure."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, get_current_user_optional, require_admin
from db.database import get_db
from db.models import User, Figure

router = APIRouter(tags=["trading"])

MAX_ACTIVE_ORDERS = 3
EXPIRY_DAYS = 30


class OrderIn(BaseModel):
    order_type: str  # "buy" or "sell"
    price: int
    currency: str = "TWD"
    condition: str  # "sealed", "opened", "used", "damaged"
    contact: str  # Line ID, FB link, etc.
    notes: str | None = None


# ── Public: view board ────────────────────────────────────

@router.get("/figures/{figure_id}/board")
async def get_board(
    figure_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get active buy/sell posts for a figure. Contact info hidden."""
    result = await db.execute(text("""
        SELECT o.id, o.order_type, o.price, o.currency, o.condition, o.notes,
               o.created_at, o.expires_at,
               u.id as user_id, u.username, u.display_name
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.figure_id = :fid
        AND o.status = 'active'
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY
            CASE WHEN o.order_type = 'buy' THEN o.price END DESC,
            CASE WHEN o.order_type = 'sell' THEN o.price END ASC,
            o.created_at ASC
    """), {"fid": figure_id})

    orders = []
    for r in result.all():
        orders.append({
            "id": r[0],
            "order_type": r[1],
            "price": r[2],
            "currency": r[3],
            "condition": r[4],
            "notes": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
            "expires_at": r[7].isoformat() if r[7] else None,
            "user_id": r[8],
            "username": r[9],
            "display_name": r[10],
        })
    return orders


@router.get("/figures/{figure_id}/board/{order_id}/contact")
async def get_contact(
    figure_id: int,
    order_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get poster's contact info. Requires login."""
    result = await db.execute(text("""
        SELECT o.contact, u.username, u.display_name
        FROM orders o
        JOIN users u ON o.user_id = u.id
        WHERE o.id = :oid AND o.figure_id = :fid
        AND o.status = 'active'
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
    """), {"oid": order_id, "fid": figure_id})
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"contact": row[0], "username": row[1], "display_name": row[2]}


# ── Auth: create/delete posts ─────────────────────────────

@router.post("/figures/{figure_id}/board")
async def create_order(
    figure_id: int,
    body: OrderIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a buy or sell post."""
    if body.order_type not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="order_type must be buy or sell")
    if body.price <= 0 or body.price > 10000000:
        raise HTTPException(status_code=400, detail="Invalid price")
    if body.currency not in ("TWD", "JPY", "CNY", "USD"):
        raise HTTPException(status_code=400, detail="Invalid currency")
    if body.condition not in ("sealed", "opened", "used", "damaged"):
        raise HTTPException(status_code=400, detail="Invalid condition")
    if not body.contact or not body.contact.strip():
        raise HTTPException(status_code=400, detail="Contact is required")
    if len(body.contact) > 200:
        raise HTTPException(status_code=400, detail="Contact too long")

    # Check figure exists
    fig = await db.execute(select(Figure.id).where(Figure.id == figure_id))
    if not fig.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Figure not found")

    # Max active orders per user
    active_count = (await db.execute(
        text("SELECT COUNT(*) FROM orders WHERE user_id = :uid AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())"),
        {"uid": user.id},
    )).scalar() or 0
    if active_count >= MAX_ACTIVE_ORDERS:
        raise HTTPException(status_code=400, detail=f"最多只能有 {MAX_ACTIVE_ORDERS} 筆進行中的交易單")

    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=EXPIRY_DAYS)

    await db.execute(text("""
        INSERT INTO orders (user_id, figure_id, order_type, price, currency, condition, contact, notes, status, expires_at, created_at, updated_at)
        VALUES (:uid, :fid, :otype, :price, :currency, :cond, :contact, :notes, 'active', :expires, :now, :now)
    """), {
        "uid": user.id, "fid": figure_id, "otype": body.order_type,
        "price": body.price, "currency": body.currency, "cond": body.condition,
        "contact": body.contact.strip(), "notes": (body.notes or "").strip()[:500] or None,
        "expires": expires, "now": now,
    })
    await db.commit()
    return {"status": "ok", "message": "已發布"}


@router.delete("/figures/{figure_id}/board/{order_id}")
async def delete_order(
    figure_id: int,
    order_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete own post (or admin can delete any)."""
    result = await db.execute(
        text("SELECT user_id FROM orders WHERE id = :oid AND figure_id = :fid"),
        {"oid": order_id, "fid": figure_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    if row[0] != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Can only delete your own posts")

    await db.execute(
        text("UPDATE orders SET status = 'cancelled' WHERE id = :oid"),
        {"oid": order_id},
    )
    await db.commit()
    return {"status": "ok"}


# ── User: my orders ──────────────────────────────────────

@router.get("/user/my-orders")
async def my_orders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user's active orders across all figures."""
    result = await db.execute(text("""
        SELECT o.id, o.figure_id, f.name, f.image_url, o.order_type, o.price, o.currency,
               o.condition, o.notes, o.created_at, o.expires_at
        FROM orders o
        JOIN figures f ON o.figure_id = f.id
        WHERE o.user_id = :uid AND o.status = 'active'
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY o.created_at DESC
    """), {"uid": user.id})
    return [
        {"id": r[0], "figure_id": r[1], "figure_name": r[2], "figure_image": r[3],
         "order_type": r[4], "price": r[5], "currency": r[6], "condition": r[7],
         "notes": r[8], "created_at": r[9].isoformat() if r[9] else None,
         "expires_at": r[10].isoformat() if r[10] else None}
        for r in result.all()
    ]
