"""AmiAmi preowned-section scraper — uses their public JSON API.

The www.amiami.com site is Cloudflare-protected, but their backend API at
api.amiami.com responds to plain GET if you send `X-User-Key: amiami_dev`
(the public key the website itself uses). The API is rate-limited — empirically
roughly 1 request every 5-10 seconds before you start getting 403s for a while.

Unlike Yahoo/Mercari, AmiAmi preowned items are *currently listed* at a retail
used price set by AmiAmi staff, not historical sold transactions. So we record
them with `is_sold=False` and no `sold_at` — they act as a current-market
reference price rather than a sold-price datapoint.
"""

import asyncio
import logging
import random
import re
from typing import Any, AsyncIterator

import httpx

logger = logging.getLogger(__name__)


class AmiAmiScraper:
    """Search AmiAmi preowned (used) inventory via their public API."""

    API = "https://api.amiami.com/api/v1.0/items"
    SITE = "https://www.amiami.com"

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=30,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/121.0.0.0 Safari/537.36"
                ),
                "X-User-Key": "amiami_dev",
                "Referer": "https://www.amiami.com/",
                "Accept": "application/json",
            },
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.client.aclose()

    async def close(self):
        await self.client.aclose()

    async def search_preowned(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search currently-listed preowned items matching `query`.

        Returns a list of dicts compatible with the Listing insert shape used
        in main.py (title, price_jpy, url, image_url, source_id, condition, is_sold).
        """
        params = {
            "pagemax": str(min(limit, 40)),
            "lang": "eng",
            "s_keywords": query,
            "s_st_condition_flg": "1",  # preowned only
        }
        try:
            resp = await self.client.get(self.API, params=params)
        except Exception:
            logger.exception("AmiAmi request failed for %r", query)
            return []

        if resp.status_code != 200:
            logger.warning("AmiAmi search %d for %r body=%s",
                           resp.status_code, query, resp.text[:120])
            return []

        try:
            data = resp.json()
        except Exception:
            logger.warning("AmiAmi non-JSON response for %r: %s", query, resp.text[:120])
            return []

        items = data.get("items") or []
        results: list[dict[str, Any]] = []
        for item in items:
            gcode = item.get("gcode")
            title = item.get("gname")
            # c_price_taxed is the AmiAmi retail used price including tax.
            # min_price/max_price are historical *new-release* references, not
            # the current used price — using them produces nonsense ratios.
            price = item.get("c_price_taxed")
            if not gcode or not title or not price or price <= 0:
                continue

            # AmiAmi preowned items always carry the -R suffix in gcode and
            # condition_flg=1; skip anything else just in case.
            if item.get("condition_flg") != 1:
                continue

            thumb = item.get("thumb_url") or ""
            image_url = (self.SITE + thumb) if thumb.startswith("/") else thumb

            results.append({
                "title": title,
                "price_jpy": int(price),
                "url": f"{self.SITE}/eng/detail/?gcode={gcode}",
                "image_url": image_url,
                "source_id": gcode,
                "condition": "used",
                "is_sold": False,
                "maker": item.get("maker_name"),
            })
        return results

    async def iter_preowned_all_pages(self) -> AsyncIterator[dict[str, Any]]:
        """Paginate through ALL preowned items in AmiAmi inventory.

        Yields normalised dicts (same shape as search_preowned results), plus a
        few extra fields useful for reverse-matching: `maker_raw` (AmiAmi's
        English maker_name string), `scale_str` (parsed from title, e.g. "1/7"),
        `jancode`. Stops on empty page, 403, or after 30 pages (safety cap; the
        full preowned set is ~500 items at pagemax=40).
        """
        for page in range(1, 30):
            # Rate-limit between pages. Originally tried 8-12s but burst from
            # 60+ requests in one day got the IP Cloudflare-banned. 15-25s
            # spreads a full ~13-page pull over ~4-5 min — still well within
            # 24h budget, and slow enough that AmiAmi's per-IP heuristic
            # treats us as a normal browsing user.
            if page > 1:
                await asyncio.sleep(random.uniform(15, 25))

            params = {
                "pagemax": "40",
                "pagecnt": str(page),
                "lang": "eng",
                "s_st_condition_flg": "1",
            }
            try:
                resp = await self.client.get(self.API, params=params)
            except Exception:
                logger.exception("AmiAmi pagination page %d failed", page)
                break

            if resp.status_code != 200:
                logger.warning(
                    "AmiAmi pagination got %d on page %d — stopping",
                    resp.status_code, page,
                )
                break

            try:
                data = resp.json()
            except Exception:
                logger.warning("AmiAmi page %d non-JSON", page)
                break

            items = data.get("items") or []
            if not items:
                logger.info("AmiAmi pagination exhausted at page %d", page)
                break

            for item in items:
                gcode = item.get("gcode")
                title = item.get("gname")
                price = item.get("c_price_taxed")
                if not gcode or not title or not price or price <= 0:
                    continue
                if item.get("condition_flg") != 1:
                    continue

                thumb = item.get("thumb_url") or ""
                image_url = (self.SITE + thumb) if thumb.startswith("/") else thumb

                # Scale appears in English title as "1/7 Scale" / "Non Scale" /
                # "1/6 Complete Figure" — parse the first 1/N occurrence so the
                # match step can constrain candidates by scale.
                scale_match = re.search(r"\b1/(\d+)\b", title)
                scale_str = f"1/{scale_match.group(1)}" if scale_match else None

                yield {
                    "title": title,
                    "price_jpy": int(price),
                    "url": f"{self.SITE}/eng/detail/?gcode={gcode}",
                    "image_url": image_url,
                    "source_id": gcode,
                    "condition": "used",
                    "is_sold": False,
                    "maker_raw": item.get("maker_name") or "",
                    "scale_str": scale_str,
                    "jancode": item.get("jancode"),
                    "releasedate": item.get("releasedate"),
                }
