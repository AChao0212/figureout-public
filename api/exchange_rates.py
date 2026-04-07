"""Fetch and cache live exchange rates."""
import logging
import httpx
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Free API: exchangerate-api.com (1500 requests/month free)
RATE_API_URL = "https://open.er-api.com/v6/latest/USD"

async def fetch_live_rates() -> dict[str, float]:
    """Fetch live exchange rates (base USD). Returns {currency: rate_per_usd}."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(RATE_API_URL)
            resp.raise_for_status()
            data = resp.json()
            if data.get("result") == "success":
                rates = data["rates"]
                return {
                    "USD": 1.0,
                    "TWD": rates.get("TWD", 32.2),
                    "JPY": rates.get("JPY", 149.5),
                    "CNY": rates.get("CNY", 7.25),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
    except Exception as e:
        logger.warning("Failed to fetch live rates: %s", e)
    # Fallback
    return {"USD": 1.0, "TWD": 32.2, "JPY": 149.5, "CNY": 7.25, "updated_at": None}
