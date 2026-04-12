"""Unified user authentication — register, login, profile, rankings, watchlist."""
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from collections import defaultdict
from time import time

# In-memory rate limit fallback when Redis is down
_login_attempts: dict[str, list[float]] = defaultdict(list)
def _check_memory_rate_limit(ip: str, max_attempts: int = 5, window: int = 60) -> bool:
    """Returns True if rate limited."""
    now = time()
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < window]
    if len(_login_attempts[ip]) >= max_attempts:
        return True
    _login_attempts[ip].append(now)
    return False
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    get_real_ip,
    hash_password, verify_password, create_token,
    get_current_user, get_current_user_optional, require_admin,
)
from db.database import get_db
from db.models import User

router = APIRouter(prefix="/user", tags=["user"])

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,30}$")


# ── Schemas ───────────────────────────────────────────────

class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str | None = None

class LoginIn(BaseModel):
    username: str
    password: str

class WatchlistItemIn(BaseModel):
    type: str = "interested"

class WatchlistMergeIn(BaseModel):
    items: list[dict]


# ── Auth Endpoints ────────────────────────────────────────

@router.post("/register")
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not USERNAME_RE.match(body.username):
        raise HTTPException(status_code=400, detail="帳號只能使用英文、數字和底線，長度 3-30 字元")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密碼至少 6 個字元")

    existing = await db.execute(
        select(User).where(func.lower(User.username) == body.username.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="此帳號已被使用")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.username,
        role="user",
    )
    db.add(user)
    await db.flush()
    await db.commit()
    await db.refresh(user)

    token = create_token(user.id, user.username, user.role)
    return {
        "token": token,
        "user": {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role},
    }


@router.post("/login")
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    # Rate limit
    import redis.asyncio as aioredis
    try:
        r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        ip = get_real_ip(request)
        key = f"login_attempts:{ip}"
        attempts = await r.incr(key)
        if attempts == 1:
            await r.expire(key, 60)
        await r.aclose()
        if attempts > 5:
            raise HTTPException(status_code=429, detail="登入嘗試太頻繁，請稍後再試")
    except HTTPException:
        raise
    except Exception:
        # Redis down — use in-memory fallback
        ip = get_real_ip(request)
        if _check_memory_rate_limit(ip):
            raise HTTPException(status_code=429, detail="登入嘗試太頻繁，請稍後再試")

    result = await db.execute(
        select(User).where(func.lower(User.username) == body.username.lower())
    )
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="帳號已被暫停")

    token = create_token(user.id, user.username, user.role)
    return {
        "token": token,
        "user": {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role},
    }


@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count_result = await db.execute(
        text("SELECT COUNT(*) FROM user_reports WHERE user_id = :uid"),
        {"uid": user.id},
    )
    report_count = count_result.scalar() or 0
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "report_count": report_count,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.patch("/me")
async def update_me(body: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    display_name = body.get("display_name", "").strip()
    if not display_name or len(display_name) > 50:
        raise HTTPException(status_code=400, detail="顯示名稱 1-50 字元")
    user.display_name = display_name
    await db.commit()
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role}


# ── Rankings ──────────────────────────────────────────────

@router.get("/rankings")
async def get_rankings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT u.id, u.username, u.display_name, u.role,
               COUNT(DISTINCT ur.id) as report_count,
               COUNT(DISTINCT fn.id) as note_count
        FROM users u
        LEFT JOIN user_reports ur ON ur.user_id = u.id
        LEFT JOIN figure_notes fn ON fn.user_id = u.id AND fn.status = 'visible'
        WHERE u.is_suspended = false
        GROUP BY u.id, u.username, u.display_name, u.role
        HAVING COUNT(DISTINCT ur.id) > 0 OR COUNT(DISTINCT fn.id) > 0
        ORDER BY (COUNT(DISTINCT ur.id) + COUNT(DISTINCT fn.id)) DESC
        LIMIT 50
    """))
    return [
        {"user_id": r[0], "username": r[1], "display_name": r[2], "role": r[3],
         "report_count": r[4], "note_count": r[5]}
        for r in result.all()
    ]


# ── Editor Application ───────────────────────────────────

@router.post("/apply-editor")
async def apply_editor(body: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """User applies to become editor. Creates an error_report for admin to review."""
    if user.role in ("editor", "admin"):
        raise HTTPException(status_code=400, detail="你已經是編輯者或管理員")

    # Check if already applied
    existing = await db.execute(
        text("SELECT id FROM error_reports WHERE report_type = 'editor_application' AND description LIKE :pattern AND status = 'pending'"),
        {"pattern": f"User #{user.id} %"},
    )
    if existing.first():
        raise HTTPException(status_code=400, detail="你已經提交過申請，請等待審核")

    reason = (body.get("reason") or "").strip()[:200] or "未填寫"

    # Count user's reports
    count = (await db.execute(
        text("SELECT COUNT(*) FROM user_reports WHERE user_id = :uid"),
        {"uid": user.id},
    )).scalar() or 0

    await db.execute(
        text("INSERT INTO error_reports (report_type, description, status) VALUES ('editor_application', :desc, 'pending')"),
        {"desc": f"User #{user.id} @{user.username} ({user.display_name}) 申請成為編輯者。目前貢獻: {count} 筆回報。理由: {reason}"},
    )
    await db.commit()
    return {"status": "ok", "message": "申請已送出，請等待管理員審核"}


# ── Admin: Approve Editor Application ─────────────────

@router.post("/approve-editor/{report_id}")
async def approve_editor_application(
    report_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve an editor application — promote user to editor."""
    # Get the error report
    result = await db.execute(
        text("SELECT id, description, status FROM error_reports WHERE id = :rid AND report_type = 'editor_application'"),
        {"rid": report_id},
    )
    report = result.first()
    if not report:
        raise HTTPException(status_code=404, detail="Application not found")
    if report[2] != "pending":
        raise HTTPException(status_code=400, detail="Application already processed")

    # Extract user_id from description "User #123 ..."
    import re
    m = re.search(r"User #(\d+)", report[1])
    if not m:
        raise HTTPException(status_code=400, detail="Cannot parse user ID from application")
    
    target_id = int(m.group(1))
    target = (await db.execute(select(User).where(User.id == target_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    target.role = "editor"
    await db.execute(
        text("UPDATE error_reports SET status = 'resolved', reviewed_at = NOW() WHERE id = :rid"),
        {"rid": report_id},
    )
    await db.commit()
    return {"status": "ok", "user_id": target.id, "username": target.username, "new_role": "editor"}


@router.post("/reject-editor/{report_id}")
async def reject_editor_application(
    report_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reject an editor application."""
    await db.execute(
        text("UPDATE error_reports SET status = 'dismissed', reviewed_at = NOW() WHERE id = :rid AND report_type = 'editor_application'"),
        {"rid": report_id},
    )
    await db.commit()
    return {"status": "ok"}


# ── Admin: Promote/Demote Users ──────────────────────────

@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: int,
    body: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin sets a user's role."""
    new_role = body.get("role", "")
    if new_role not in ("user", "editor", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    target.role = new_role
    await db.commit()
    return {"id": target.id, "username": target.username, "role": target.role}


@router.get("/users")
async def list_users(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Admin lists all users."""
    result = await db.execute(text("""
        SELECT u.id, u.username, u.display_name, u.role, u.is_suspended, u.created_at,
               COUNT(ur.id) as report_count
        FROM users u
        LEFT JOIN user_reports ur ON ur.user_id = u.id
        WHERE u.username IS NOT NULL
        GROUP BY u.id
        ORDER BY u.id
    """))
    return [
        {"id": r[0], "username": r[1], "display_name": r[2], "role": r[3],
         "is_suspended": r[4], "created_at": r[5].isoformat() if r[5] else None, "report_count": r[6]}
        for r in result.all()
    ]


# ── Watchlist Sync ────────────────────────────────────────

@router.get("/watchlist")
async def get_watchlist(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT figure_id, type, created_at FROM user_watchlist WHERE user_id = :uid ORDER BY created_at DESC"),
        {"uid": user.id},
    )
    return [{"id": r[0], "type": r[1], "created_at": r[2].isoformat() if r[2] else None} for r in result.all()]


@router.post("/watchlist/{figure_id}")
async def add_watchlist(figure_id: int, body: WatchlistItemIn = WatchlistItemIn(), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.type not in ("interested", "owned"):
        raise HTTPException(status_code=400, detail="type must be interested or owned")
    await db.execute(text("""
        INSERT INTO user_watchlist (user_id, figure_id, type) VALUES (:uid, :fid, :type)
        ON CONFLICT (user_id, figure_id) DO UPDATE SET type = :type
    """), {"uid": user.id, "fid": figure_id, "type": body.type})
    await db.commit()
    return {"status": "ok"}


@router.patch("/watchlist/{figure_id}")
async def update_watchlist(figure_id: int, body: WatchlistItemIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.type not in ("interested", "owned"):
        raise HTTPException(status_code=400, detail="type must be interested or owned")
    await db.execute(text("UPDATE user_watchlist SET type = :type WHERE user_id = :uid AND figure_id = :fid"),
        {"uid": user.id, "fid": figure_id, "type": body.type})
    await db.commit()
    return {"status": "ok"}


@router.delete("/watchlist/{figure_id}")
async def remove_watchlist(figure_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(text("DELETE FROM user_watchlist WHERE user_id = :uid AND figure_id = :fid"),
        {"uid": user.id, "fid": figure_id})
    await db.commit()
    return {"status": "ok"}


@router.post("/watchlist/merge")
async def merge_watchlist(body: WatchlistMergeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    for item in body.items[:100]:
        fid = item.get("id")
        wtype = item.get("type", "interested")
        if not fid or wtype not in ("interested", "owned"):
            continue
        await db.execute(text("""
            INSERT INTO user_watchlist (user_id, figure_id, type) VALUES (:uid, :fid, :type)
            ON CONFLICT (user_id, figure_id) DO NOTHING
        """), {"uid": user.id, "fid": int(fid), "type": wtype})
    await db.commit()
    return {"status": "ok", "merged": len(body.items)}


# ── Purchase Tracking (已購入) ────────────────────────────

class PurchaseIn(BaseModel):
    price: int | None = None
    currency: str | None = None
    condition: str | None = None
    purchase_date: str | None = None  # ISO date
    platform: str | None = None  # public: where they bought it (FB, etc)
    notes: str | None = None  # public report notes (links, etc)
    user_report_id: int | None = None  # Link to existing user_report
    create_report: bool = False  # If true, also create a user_report


class PurchaseUpdateIn(BaseModel):
    price: int | None = None
    currency: str | None = None
    condition: str | None = None
    purchase_date: str | None = None
    platform: str | None = None  # public: transaction platform
    notes: str | None = None  # used for both private (notes-only PATCH) and public report notes (with create_report)
    private_notes: str | None = None  # explicitly private notes for the purchase row
    create_report: bool = False  # If true and price is being added, also create a user_report


@router.get("/purchases")
async def list_purchases(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's purchases with figure details."""
    result = await db.execute(text("""
        SELECT p.id, p.figure_id, f.name, f.image_url, f.manufacturer,
               p.price, p.currency, p.condition, p.purchase_date,
               p.notes, p.user_report_id, p.created_at
        FROM user_purchases p
        JOIN figures f ON p.figure_id = f.id
        WHERE p.user_id = :uid
        ORDER BY p.created_at DESC
    """), {"uid": user.id})
    return [
        {
            "id": r[0],
            "figure_id": r[1],
            "figure_name": r[2],
            "figure_image": r[3],
            "manufacturer": r[4],
            "price": r[5],
            "currency": r[6],
            "condition": r[7],
            "purchase_date": r[8].isoformat() if r[8] else None,
            "notes": r[9],
            "user_report_id": r[10],
            "created_at": r[11].isoformat() if r[11] else None,
        }
        for r in result.all()
    ]


@router.get("/purchases/my-reports/{figure_id}")
async def list_my_reports_for_figure(
    figure_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user's own price reports for a specific figure (used in purchase modal)."""
    result = await db.execute(text("""
        SELECT id, price, currency, condition, platform, notes, created_at
        FROM user_reports
        WHERE user_id = :uid AND figure_id = :fid
        ORDER BY created_at DESC
        LIMIT 20
    """), {"uid": user.id, "fid": figure_id})
    return [
        {
            "id": r[0],
            "price": r[1],
            "currency": r[2],
            "condition": r[3],
            "platform": r[4],
            "notes": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in result.all()
    ]


async def _create_community_report_from_purchase(
    db, *, figure_id: int, user_id: int, price: int, currency: str,
    condition: str | None, platform: str | None, notes: str | None,
    purchase_date,
) -> int:
    """Create a user_report AND a listing + recalculate snapshots.
    Mirrors what submit_price_report does, so the price shows in the figure detail page.
    Returns the new user_report id.
    """
    # Fetch figure name for listing title
    fig_name_result = await db.execute(
        text("SELECT name FROM figures WHERE id = :fid"), {"fid": figure_id}
    )
    fig_row = fig_name_result.first()
    figure_name = fig_row[0] if fig_row else ""

    # Insert user_report
    report_result = await db.execute(text("""
        INSERT INTO user_reports (figure_id, price, currency, condition, platform, user_id, notes)
        VALUES (:fid, :price, :currency, :cond, :platform, :uid, :notes)
        RETURNING id
    """), {
        "fid": figure_id, "price": price, "currency": currency,
        "cond": condition or "used",
        "platform": (platform or "").strip() or None,
        "uid": user_id,
        "notes": (notes or "").strip() or None,
    })
    new_report_id = report_result.first()[0]

    # Also create a listing row so it shows on the figure detail page
    RATES_TO_USD = {"JPY": 1/149.5, "TWD": 1/32.2, "USD": 1, "CNY": 1/7.25}
    price_usd = price * RATES_TO_USD.get(currency, 1)
    cond_value = condition or "used"
    # Match submit_price_report title format: "<figure name> - <platform or 社群回報>"
    title = (figure_name + " - " + ((platform or "").strip() or "社群回報")).strip(" -")
    # Use purchase_date as sold_at if provided, else NOW
    from datetime import datetime as _dt2, timezone as _tz2
    sold_at = None
    if purchase_date:
        sold_at = _dt2.combine(purchase_date, _dt2.min.time()).replace(tzinfo=_tz2.utc)

    await db.execute(text("""
        INSERT INTO listings (figure_id, source, source_id, title, price, currency, price_usd, condition, is_sold, notes, sold_at, scraped_at)
        VALUES (:fid, 'user_report', :src_id, :title, :price, :currency, :price_usd, :cond, true, :notes, :sold_at, NOW())
    """), {
        "fid": figure_id,
        "src_id": f"ur_{new_report_id}_{figure_id}",
        "title": title,
        "price": price,
        "currency": currency,
        "price_usd": round(price_usd, 2),
        "cond": cond_value,
        "notes": (notes or "").strip() or None,
        "sold_at": sold_at,
    })

    # Recalculate snapshots so the new data shows up in price charts
    try:
        from routers.figures import recalculate_figure_snapshots
        await recalculate_figure_snapshots(figure_id, db)
    except Exception:
        pass

    return new_report_id


@router.post("/purchases/{figure_id}")
async def create_purchase(
    figure_id: int,
    body: PurchaseIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a figure as purchased. Optionally link to existing report or create a new one."""
    # Check figure exists
    fig_result = await db.execute(text("SELECT id FROM figures WHERE id = :fid"), {"fid": figure_id})
    if not fig_result.first():
        raise HTTPException(status_code=404, detail="Figure not found")

    # Check if already purchased
    existing = await db.execute(
        text("SELECT id FROM user_purchases WHERE user_id = :uid AND figure_id = :fid"),
        {"uid": user.id, "fid": figure_id},
    )
    if existing.first():
        raise HTTPException(status_code=400, detail="已經在已購入清單中")

    # Validate linked report if provided
    if body.user_report_id:
        rep_result = await db.execute(
            text("SELECT price, currency, condition FROM user_reports WHERE id = :rid AND user_id = :uid AND figure_id = :fid"),
            {"rid": body.user_report_id, "uid": user.id, "fid": figure_id},
        )
        rep = rep_result.first()
        if not rep:
            raise HTTPException(status_code=400, detail="無效的價格回報")
        # Copy data from report
        price = rep[0]
        currency = rep[1]
        condition = rep[2]
        user_report_id = body.user_report_id
    else:
        # Use body data
        price = body.price
        currency = body.currency
        condition = body.condition
        user_report_id = None

    # Parse purchase_date
    purchase_date = None
    if body.purchase_date:
        try:
            from datetime import datetime as _dt
            purchase_date = _dt.fromisoformat(body.purchase_date).date()
        except Exception:
            pass

    # Optionally create a price report + listing from this purchase
    if not body.user_report_id and body.create_report and price and currency:
        if price <= 0 or price > 10000000:
            raise HTTPException(status_code=400, detail="Invalid price")
        if currency not in ("TWD", "JPY", "CNY", "USD"):
            raise HTTPException(status_code=400, detail="Invalid currency")
        user_report_id = await _create_community_report_from_purchase(
            db,
            figure_id=figure_id,
            user_id=user.id,
            price=price,
            currency=currency,
            condition=condition,
            platform=body.platform,
            notes=body.notes,
            purchase_date=purchase_date,
        )

    # Remove from watchlist if present
    await db.execute(
        text("DELETE FROM user_watchlist WHERE user_id = :uid AND figure_id = :fid"),
        {"uid": user.id, "fid": figure_id},
    )

    # Insert purchase — purchase.notes is PRIVATE (separate from user_reports.notes which is public)
    # On initial creation via form submission, we leave purchase.notes NULL.
    # The user can add private notes later via the "+ 備註" button on the purchase card.
    await db.execute(text("""
        INSERT INTO user_purchases (user_id, figure_id, price, currency, condition, purchase_date, notes, user_report_id)
        VALUES (:uid, :fid, :price, :currency, :cond, :pdate, NULL, :rid)
    """), {
        "uid": user.id, "fid": figure_id,
        "price": price, "currency": currency, "cond": condition,
        "pdate": purchase_date,
        "rid": user_report_id,
    })
    await db.commit()
    return {"status": "ok"}


@router.patch("/purchases/{purchase_id}")
async def update_purchase(
    purchase_id: int,
    body: PurchaseUpdateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update purchase details.

    - When create_report=true AND price is being added for the first time, creates a user_report
      AND a listing row AND recalculates snapshots. The form's `notes` go to the PUBLIC report.
    - When create_report is false (default), this is a simple edit:
      * If `private_notes` is provided, that updates user_purchases.notes (private field).
      * If `notes` is provided without create_report, it also updates user_purchases.notes
        (backward-compat: pure notes edit from the "編輯備註" button).
    - user_reports.notes is NEVER touched by this endpoint, so editing private notes on the
      purchase card does NOT modify the community report.
    """
    # Verify ownership and get current data
    result = await db.execute(
        text("SELECT id, figure_id, price, user_report_id FROM user_purchases WHERE id = :pid AND user_id = :uid"),
        {"pid": purchase_id, "uid": user.id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    current_price = row[2]
    current_report_id = row[3]
    figure_id = row[1]

    # Parse purchase_date
    purchase_date_parsed = None
    if body.purchase_date is not None:
        try:
            from datetime import datetime as _dt
            purchase_date_parsed = _dt.fromisoformat(body.purchase_date).date() if body.purchase_date else None
        except Exception:
            pass

    # If the caller is filling in price + creating a community report for the first time
    if body.create_report and body.price and body.currency and not current_price and not current_report_id:
        if body.price <= 0 or body.price > 10000000:
            raise HTTPException(status_code=400, detail="Invalid price")
        if body.currency not in ("TWD", "JPY", "CNY", "USD"):
            raise HTTPException(status_code=400, detail="Invalid currency")
        new_report_id = await _create_community_report_from_purchase(
            db,
            figure_id=figure_id,
            user_id=user.id,
            price=body.price,
            currency=body.currency,
            condition=body.condition,
            platform=body.platform,
            notes=body.notes,  # public report notes
            purchase_date=purchase_date_parsed,
        )

        # Build the purchase update — in create-report mode, DO NOT write body.notes to
        # user_purchases.notes (that's the public report notes, private field stays NULL).
        await db.execute(text("""
            UPDATE user_purchases
            SET price = :price, currency = :currency, condition = :condition,
                purchase_date = :pdate, user_report_id = :rid
            WHERE id = :pid
        """), {
            "pid": purchase_id,
            "price": body.price,
            "currency": body.currency,
            "condition": body.condition,
            "pdate": purchase_date_parsed,
            "rid": new_report_id,
        })
        await db.commit()
        return {"status": "ok"}

    # Simple edit path (no report creation) — update only user_purchases fields.
    # user_reports.notes is NEVER modified here.
    updates = []
    params = {"pid": purchase_id}
    for field, val in [
        ("price", body.price),
        ("currency", body.currency),
        ("condition", body.condition),
    ]:
        if val is not None:
            updates.append(f"{field} = :{field}")
            params[field] = val

    # notes and private_notes both target user_purchases.notes (private field).
    # private_notes takes precedence if both are provided.
    private_val = body.private_notes if body.private_notes is not None else body.notes
    if private_val is not None:
        updates.append("notes = :notes")
        params["notes"] = private_val or None

    if body.purchase_date is not None:
        updates.append("purchase_date = :purchase_date")
        params["purchase_date"] = purchase_date_parsed

    if updates:
        await db.execute(
            text(f"UPDATE user_purchases SET {', '.join(updates)} WHERE id = :pid"),
            params,
        )
        await db.commit()
    return {"status": "ok"}


@router.delete("/purchases/{purchase_id}")
async def delete_purchase(
    purchase_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a purchase from the list. Also deletes the linked user_report + listing
    (if the report was auto-created from this purchase), so the community data stays
    in sync with the user's personal record."""
    # Get linked report_id and figure_id before deleting
    row_result = await db.execute(
        text("SELECT figure_id, user_report_id FROM user_purchases WHERE id = :pid AND user_id = :uid"),
        {"pid": purchase_id, "uid": user.id},
    )
    row = row_result.first()
    if not row:
        return {"status": "ok"}
    figure_id = row[0]
    linked_report_id = row[1]

    # Delete the purchase first
    await db.execute(
        text("DELETE FROM user_purchases WHERE id = :pid AND user_id = :uid"),
        {"pid": purchase_id, "uid": user.id},
    )

    # Delete the linked report + listing + recalculate snapshots
    if linked_report_id:
        await db.execute(
            text("DELETE FROM listings WHERE source = 'user_report' AND source_id = :src_id"),
            {"src_id": f"ur_{linked_report_id}_{figure_id}"},
        )
        await db.execute(
            text("DELETE FROM user_reports WHERE id = :rid AND user_id = :uid"),
            {"rid": linked_report_id, "uid": user.id},
        )
        try:
            from routers.figures import recalculate_figure_snapshots
            await recalculate_figure_snapshots(figure_id, db)
        except Exception:
            pass

    await db.commit()
    return {"status": "ok"}


@router.get("/purchases/stats")
async def purchase_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get total purchase stats — count and total spent by currency."""
    result = await db.execute(text("""
        SELECT currency, COUNT(*), COALESCE(SUM(price), 0)
        FROM user_purchases
        WHERE user_id = :uid AND price IS NOT NULL AND currency IS NOT NULL
        GROUP BY currency
    """), {"uid": user.id})
    rows = result.all()

    count_result = await db.execute(
        text("SELECT COUNT(*) FROM user_purchases WHERE user_id = :uid"),
        {"uid": user.id},
    )
    total_count = count_result.scalar() or 0

    return {
        "total_count": total_count,
        "by_currency": [
            {"currency": r[0], "count": r[1], "total": int(r[2])}
            for r in rows
        ],
    }
