"""Unified JWT authentication for all users."""
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db

SECRET_KEY = os.environ["JWT_SECRET"]
ALGORITHM = "HS256"

security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    import bcrypt
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    import bcrypt
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def create_token(user_id: int, username: str, role: str) -> str:
    """Create JWT for any user role."""
    hours = 24 if role in ("admin", "editor") else 168  # 1 day for staff, 7 days for users
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    return jwt.encode(
        {"sub": username, "user_id": user_id, "role": role, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    """Get authenticated user (any role). Returns User ORM object."""
    from db.models import User
    payload = decode_token(credentials.credentials)
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="帳號已被暫停")
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),
    db: AsyncSession = Depends(get_db),
):
    """Get user if authenticated, None otherwise."""
    if not credentials:
        return None
    try:
        from db.models import User
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            return None
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()
    except Exception:
        return None


async def require_editor(user = Depends(get_current_user)):
    """Require editor or admin role."""
    if user.role not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="需要編輯者權限")
    return user


async def require_admin(user = Depends(get_current_user)):
    """Require admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理員權限")
    return user


def get_real_ip(request) -> str:
    """Get real client IP, supporting Cloudflare CF-Connecting-IP header."""
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
