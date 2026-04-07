"""Transaction management endpoints."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Figure, Notification, Order, Transaction, User
from auth import get_current_user as require_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/my")
async def list_my_transactions(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's transactions (as buyer or seller)."""
    stmt = (
        select(Transaction)
        .join(Order, Order.id == Transaction.buy_order_id)
        .where(
            or_(
                Transaction.buy_order_id.in_(
                    select(Order.id).where(Order.user_id == user.id)
                ),
                Transaction.sell_order_id.in_(
                    select(Order.id).where(Order.user_id == user.id)
                ),
            )
        )
        .order_by(Transaction.created_at.desc())
    )

    result = await db.execute(stmt)
    txns = result.scalars().all()

    items = []
    for txn in txns:
        # Determine user's role
        buy_order_res = await db.execute(select(Order).where(Order.id == txn.buy_order_id))
        buy_order = buy_order_res.scalar_one()
        sell_order_res = await db.execute(select(Order).where(Order.id == txn.sell_order_id))
        sell_order = sell_order_res.scalar_one()

        role = "buyer" if buy_order.user_id == user.id else "seller"

        # Get figure name
        fig_res = await db.execute(select(Figure.name).where(Figure.id == txn.figure_id))
        fig_name = fig_res.scalar_one_or_none() or ""

        items.append({
            "id": txn.id,
            "figure_id": txn.figure_id,
            "figure_name": fig_name,
            "match_price": txn.match_price,
            "status": txn.status,
            "role": role,
            "created_at": txn.created_at.isoformat() if txn.created_at else None,
            "completed_at": txn.completed_at.isoformat() if txn.completed_at else None,
        })

    return items


@router.post("/{txn_id}/confirm")
async def confirm_transaction(
    txn_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm transaction completed from user's side."""
    txn_res = await db.execute(select(Transaction).where(Transaction.id == txn_id))
    txn = txn_res.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="找不到該交易")

    # Determine user's role
    buy_order_res = await db.execute(select(Order).where(Order.id == txn.buy_order_id))
    buy_order = buy_order_res.scalar_one()
    sell_order_res = await db.execute(select(Order).where(Order.id == txn.sell_order_id))
    sell_order = sell_order_res.scalar_one()

    is_buyer = buy_order.user_id == user.id
    is_seller = sell_order.user_id == user.id

    if not is_buyer and not is_seller:
        raise HTTPException(status_code=403, detail="您不是此交易的參與者")

    # Status transition
    if txn.status == "pending":
        if is_buyer:
            txn.status = "confirmed_by_buyer"
        else:
            txn.status = "confirmed_by_seller"
    elif txn.status == "confirmed_by_buyer" and is_seller:
        txn.status = "completed"
    elif txn.status == "confirmed_by_seller" and is_buyer:
        txn.status = "completed"
    else:
        raise HTTPException(status_code=400, detail="您已確認過此交易或交易狀態不允許確認")

    if txn.status == "completed":
        txn.completed_at = datetime.now(timezone.utc)

        # +5 trust to both users
        buyer_res = await db.execute(select(User).where(User.id == buy_order.user_id))
        buyer = buyer_res.scalar_one()
        seller_res = await db.execute(select(User).where(User.id == sell_order.user_id))
        seller = seller_res.scalar_one()

        buyer.trust_score = min(buyer.trust_score + 5, 200)
        seller.trust_score = min(seller.trust_score + 5, 200)

        # Update order statuses
        buy_order.status = "completed"
        sell_order.status = "completed"

        # Get figure name for notification
        fig_res = await db.execute(select(Figure.name).where(Figure.id == txn.figure_id))
        fig_name = fig_res.scalar_one_or_none() or "公仔"

        # Notify both
        for notify_user_id in [buy_order.user_id, sell_order.user_id]:
            notif = Notification(
                user_id=notify_user_id,
                type="transaction_complete",
                title="交易完成！",
                body=f"{fig_name} 的交易已完成，信任分 +5",
                data_json=json.dumps({"transaction_id": txn.id, "figure_id": txn.figure_id}),
            )
            db.add(notif)

    await db.commit()

    return {"id": txn.id, "status": txn.status}


@router.post("/{txn_id}/cancel")
async def cancel_transaction(
    txn_id: int,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a matched transaction. -20 trust to canceller."""
    txn_res = await db.execute(select(Transaction).where(Transaction.id == txn_id))
    txn = txn_res.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="找不到該交易")

    if txn.status in ("completed",):
        raise HTTPException(status_code=400, detail="已完成的交易無法取消")

    # Determine user's role
    buy_order_res = await db.execute(select(Order).where(Order.id == txn.buy_order_id))
    buy_order = buy_order_res.scalar_one()
    sell_order_res = await db.execute(select(Order).where(Order.id == txn.sell_order_id))
    sell_order = sell_order_res.scalar_one()

    is_buyer = buy_order.user_id == user.id
    is_seller = sell_order.user_id == user.id

    if not is_buyer and not is_seller:
        raise HTTPException(status_code=403, detail="您不是此交易的參與者")

    # Set transaction status
    if is_buyer:
        txn.status = "cancelled_by_buyer"
        other_order = sell_order
        other_user_id = sell_order.user_id
    else:
        txn.status = "cancelled_by_seller"
        other_order = buy_order
        other_user_id = buy_order.user_id

    # -20 trust to canceller
    canceller_res = await db.execute(select(User).where(User.id == user.id))
    canceller = canceller_res.scalar_one()
    canceller.trust_score = max(canceller.trust_score - 20, 0)

    # Set other party's order back to active
    other_order.status = "active"
    other_order.matched_with_id = None

    # Cancel the canceller's order
    if is_buyer:
        buy_order.status = "cancelled"
    else:
        sell_order.status = "cancelled"

    # Get figure name
    fig_res = await db.execute(select(Figure.name).where(Figure.id == txn.figure_id))
    fig_name = fig_res.scalar_one_or_none() or "公仔"

    # Notify the other party
    notif = Notification(
        user_id=other_user_id,
        type="transaction_cancelled",
        title="交易已被取消",
        body=f"{fig_name} 的交易已被對方取消，您的訂單已重新上架",
        data_json=json.dumps({"transaction_id": txn.id, "figure_id": txn.figure_id}),
    )
    db.add(notif)

    await db.commit()

    return {"id": txn.id, "status": txn.status}
