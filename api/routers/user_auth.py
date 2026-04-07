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
