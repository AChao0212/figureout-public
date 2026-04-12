from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import admin, analytics, browse, figures, orders, reports, user_auth

from collections import defaultdict
from time import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# Simple in-memory rate limiter
_request_counts: dict[str, list[float]] = defaultdict(list)

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        ip = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
        path = request.url.path
        now = time()

        # Skip rate limiting for auth, static files, and health checks
        # Auth endpoints are protected by their own rate limits (login attempts)
        if (path.startswith("/_next") or path == "/api/health" or
            "/user/me" in path or "/user/login" in path or "/user/register" in path):
            return await call_next(request)

        # Per-IP: max 600 requests per minute globally (generous for normal browsing)
        key = f"global:{ip}"
        _request_counts[key] = [t for t in _request_counts[key] if now - t < 60]
        if len(_request_counts[key]) > 600:
            return JSONResponse(status_code=429, content={"detail": "Too many requests"})
        _request_counts[key].append(now)

        # Per-IP: max 150 figure detail requests per minute (anti-scraping)
        if "/figures/" in path and path.count("/") <= 3 and not path.endswith("/report") and not path.endswith("/notes") and not path.endswith("/board"):
            detail_key = f"figures:{ip}"
            _request_counts[detail_key] = [t for t in _request_counts[detail_key] if now - t < 60]
            if len(_request_counts[detail_key]) > 150:
                return JSONResponse(status_code=429, content={"detail": "Too many requests. Please slow down."})
            _request_counts[detail_key].append(now)

        # Cleanup old entries periodically (every ~1000 requests)
        if len(_request_counts) > 5000:
            cutoff = now - 120
            for k in list(_request_counts.keys()):
                _request_counts[k] = [t for t in _request_counts[k] if t > cutoff]
                if not _request_counts[k]:
                    del _request_counts[k]

        return await call_next(request)

app = FastAPI(title="FigureOut API", root_path="/api")
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://figureout.tw", "https://www.figureout.tw", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(figures.router)
app.include_router(browse.router)
app.include_router(reports.router)
app.include_router(analytics.router)
app.include_router(admin.router)
app.include_router(user_auth.router)
app.include_router(orders.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
