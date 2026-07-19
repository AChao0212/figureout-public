"""Shared rate-limit helpers.

Provides a two-tier rate limiter:
1. Redis-based (preferred): shared across workers, persists across restarts
2. In-memory fallback: per-process only, used when Redis is unavailable

Both return True when the request is allowed, False when rate-limited.
"""
import logging
import os
import time
from collections import defaultdict, deque
from typing import Dict, Deque

logger = logging.getLogger(__name__)

# In-memory store: key -> deque of request timestamps (monotonic seconds)
_memory_store: Dict[str, Deque[float]] = defaultdict(deque)
_MEMORY_MAX_KEYS = 10000  # cap before cleanup


def _cleanup_memory_store() -> None:
    """Drop keys whose deques are empty or stale."""
    now = time.monotonic()
    stale_keys = []
    for key, dq in list(_memory_store.items())[:2000]:
        while dq and now - dq[0] > 7200:
            dq.popleft()
        if not dq:
            stale_keys.append(key)
    for k in stale_keys:
        _memory_store.pop(k, None)


def _memory_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Fixed-window rate limit via in-memory deque.

    Returns True if allowed, False if limit exceeded.
    """
    now = time.monotonic()
    dq = _memory_store[key]
    cutoff = now - window_seconds
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    if len(_memory_store) > _MEMORY_MAX_KEYS:
        _cleanup_memory_store()
    return True


async def check_rate_limit(
    redis_client,
    key: str,
    limit: int,
    window_seconds: int,
    *,
    fail_closed: bool = False,
) -> bool:
    """Check rate limit with Redis, falling back to in-memory store on Redis errors.

    Args:
        redis_client: an async redis client (or None)
        key: unique key like "login:1.2.3.4"
        limit: max requests per window
        window_seconds: window size in seconds
        fail_closed: if True and Redis raises, deny the request (for security-critical endpoints)

    Returns True if the request is allowed, False if rate-limited.
    """
    if redis_client is None:
        return _memory_rate_limit(key, limit, window_seconds)

    try:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, window_seconds)
        return current <= limit
    except Exception as e:
        logger.warning("Redis rate-limit error for %s: %s", key, e)
        if fail_closed:
            return False
        return _memory_rate_limit(key, limit, window_seconds)


async def get_redis():
    """Get a redis client or None if unavailable. Safe to call many times."""
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        return client
    except Exception as e:
        logger.warning("Redis connection failed: %s", e)
        return None
