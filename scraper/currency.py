"""Centralized currency conversion and price aggregation helpers.

NOTE: this file is a mirror of `api/currency.py` so the scraper has the same
aggregation semantics as the API without crossing Docker build contexts.
When you edit one, edit the other — keep them byte-identical for the public surface.

DB stores listings in their original (price, currency) pairs. Display values are
computed on-the-fly using live exchange rates (cached 1h in Redis). Same-currency
display short-circuits to preserve the original number — no lossy USD round-trip.

Public API:
    FALLBACK_RATES, VALID_CURRENCIES, DEFAULT_CURRENCY  — constants
    normalize_currency(value, default) → str
    get_live_rates() → dict[str, float]               (async, Redis-cached)
    to_display(price, from_currency, target, rates)   → float | None
    retail_to_display(price, retail_currency, target, rates) → float
    aggregate_prices(prices, trim_pct=None)           → {avg, median, min, max, count}
"""

from __future__ import annotations

import json
import logging
import os
from statistics import median as _median
from typing import Iterable

logger = logging.getLogger(__name__)

# Fallback rates quoted as units-per-USD (e.g. TWD=32.2 means 1 USD = 32.2 TWD).
# Used when Redis or the upstream rate provider is unavailable. Stable on purpose
# so the fallback path is deterministic.
FALLBACK_RATES: dict[str, float] = {"USD": 1.0, "TWD": 32.2, "JPY": 149.5, "CNY": 7.25}

VALID_CURRENCIES: tuple[str, ...] = ("USD", "TWD", "JPY", "CNY")

# Canonical default used by legacy callers that don't pass ?currency=
DEFAULT_CURRENCY = "USD"


def normalize_currency(value: str | None, default: str = DEFAULT_CURRENCY) -> str:
    """Return a valid currency code or `default`."""
    if not value:
        return default
    upper = value.upper()
    return upper if upper in VALID_CURRENCIES else default


async def get_live_rates() -> dict[str, float]:
    """Fetch live exchange rates from Redis cache; refresh from upstream on miss.

    Returns FALLBACK_RATES if Redis or upstream are unavailable. Logs failures
    via the module logger (not silent)."""
    try:
        import redis.asyncio as aioredis
        redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
        r = aioredis.from_url(redis_url)
        try:
            cached = await r.get("exchange_rates")
            if cached:
                data = json.loads(cached)
                return {c: float(data.get(c, FALLBACK_RATES[c])) for c in VALID_CURRENCIES}
            # Cache miss — fetch fresh and write through.
            from exchange_rates import fetch_live_rates
            rates = await fetch_live_rates()
            await r.setex("exchange_rates", 3600, json.dumps(rates))
            return {c: float(rates.get(c, FALLBACK_RATES[c])) for c in VALID_CURRENCIES}
        finally:
            await r.aclose()
    except Exception:
        logger.exception("get_live_rates: falling back to FALLBACK_RATES")
        return dict(FALLBACK_RATES)


def to_display(price, from_currency: str | None, target: str, rates: dict) -> float | None:
    """Convert a price to the display currency.

    Same-currency: returns the original number unchanged (avoids lossy USD round-trip).
    Cross-currency: pivots through USD using the supplied rates dict.
    Returns None if `price` is None."""
    if price is None:
        return None
    p = float(price)
    fc = (from_currency or DEFAULT_CURRENCY).upper()
    if fc == target:
        return p
    from_rate = rates.get(fc, FALLBACK_RATES.get(fc, 1.0))
    target_rate = rates.get(target, FALLBACK_RATES.get(target, 1.0))
    if not from_rate:
        return p * target_rate
    usd = p / from_rate
    return usd * target_rate


def retail_to_display(price, retail_currency: str | None, target: str, rates: dict) -> float:
    """Convert retail price (default JPY) to display currency. Returns 0 if missing."""
    if not price:
        return 0.0
    converted = to_display(price, retail_currency or "JPY", target, rates)
    return converted if converted is not None else 0.0


def aggregate_prices(
    prices: Iterable[float],
    trim_pct: float | None = None,
) -> dict:
    """Compute avg / median / min / max / count over a list of prices.

    - `trim_pct=10` and N >= 5: drop the top and bottom 10% before averaging
      (suppresses outliers; matches `get_figure` summary semantics).
    - `trim_pct=None`: untrimmed (matches per-day and per-condition aggregates).

    All values rounded to 2 decimals. Empty input → all None, count=0.
    """
    seq = sorted(float(p) for p in prices if p is not None)
    n = len(seq)
    if n == 0:
        return {"avg": None, "median": None, "min": None, "max": None, "count": 0}
    if trim_pct and n >= 5:
        tc = max(1, int(n * trim_pct / 100))
        avg_seq = seq[tc:-tc] or seq
    else:
        avg_seq = seq
    return {
        "avg": round(sum(avg_seq) / len(avg_seq), 2),
        "median": round(_median(seq), 2),
        "min": round(seq[0], 2),
        "max": round(seq[-1], 2),
        "count": n,
    }
