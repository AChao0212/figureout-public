"""Admin auth — now uses unified user system. Kept for backward compatibility."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import create_token, verify_password, require_admin
from db.database import get_db
from db.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Unified login — works for all roles."""
    import redis.asyncio as aioredis
    import os
    try:
        r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        ip = request.client.host if request.client else "unknown"
        key = f"login_attempts:{ip}"
        attempts = await r.incr(key)
        if attempts == 1:
            await r.expire(key, 60)
        await r.aclose()
        if attempts > 5:
            raise HTTPException(status_code=429, detail="登入嘗試太頻繁")
    except HTTPException:
        raise
    except Exception:
        pass

    result = await db.execute(
        select(User).where(func.lower(User.username) == req.username.lower())
    )
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

    token = create_token(user.id, user.username, user.role)
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
    }


@router.get("/me")
async def get_me(user = Depends(require_admin)):
    return {"username": user.username, "role": user.role}
