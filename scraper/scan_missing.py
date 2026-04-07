"""Scan Hpoi IDs we don't have and import valid figures."""
import asyncio
import logging
import random
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('scan_missing')

from sqlalchemy import create_engine, text
from opencc import OpenCC

DB_URL = os.environ.get('DATABASE_URL_SYNC', 'postgresql://figureout:figureout_dev@db:5432/figureout')
s2t = OpenCC('s2t')

# Minimum price thresholds
MIN_JPY = 3700
MIN_CNY = 180

async def main():
    from scrapers.hpoi_detail import HpoiDetailScraper

    engine = create_engine(DB_URL)

    # Get IDs we already have
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT source_id FROM figures WHERE source_id IS NOT NULL")).all()
    existing_ids = set(int(r[0]) for r in rows if r[0] and r[0].isdigit())
    logger.info('We have %d figures', len(existing_ids))

    # Scan range
    max_id = max(existing_ids) + 5000  # scan a bit beyond our max
    all_ids = set(range(1, max_id + 1)) - existing_ids
    logger.info('Scanning %d missing IDs (1 to %d)', len(all_ids), max_id)

    scraper = HpoiDetailScraper()
    imported = 0
    skipped = 0
    not_found = 0
    errors = 0
    sem = asyncio.Semaphore(3)

    results = {}

    async def fetch_one(hpoi_id):
        nonlocal not_found, errors
        async with sem:
            try:
                data = await scraper.fetch_detail(hpoi_id)
                if data:
                    results[hpoi_id] = data
                else:
                    not_found += 1
            except Exception:
                errors += 1
            await asyncio.sleep(random.uniform(0.3, 0.8))

    # Process in batches
    ids_list = sorted(all_ids)
    batch_size = 200
    for i in range(0, len(ids_list), batch_size):
        batch = ids_list[i:i+batch_size]
        logger.info('Batch %d-%d of %d (imported=%d, skipped=%d, 404=%d, errors=%d)',
                     i, i+len(batch), len(ids_list), imported, skipped, not_found, errors)

        tasks = [fetch_one(hid) for hid in batch]
        await asyncio.gather(*tasks)

        # Import valid figures from this batch
        with engine.begin() as conn:
            for hpoi_id, data in list(results.items()):
                try:
                    ft = data.get('figure_type', '')
                    # Only import PVC figures (比例人形, Q版人形)
                    if ft and ft not in ('比例人形', 'Q版人形', '拼裝人形'):
                        skipped += 1
                        del results[hpoi_id]
                        continue

                    # Check price threshold
                    price_jpy = data.get('price_jpy')
                    price_cny = data.get('price_cny')
                    if price_jpy and price_jpy < MIN_JPY and not price_cny:
                        skipped += 1
                        del results[hpoi_id]
                        continue
                    if price_cny and price_cny < MIN_CNY:
                        skipped += 1
                        del results[hpoi_id]
                        continue

                    name = s2t.convert(data.get('japanese_name', ''))
                    if not name:
                        skipped += 1
                        del results[hpoi_id]
                        continue

                    character = s2t.convert(data.get('character', '')) if data.get('character') else ''
                    franchise = s2t.convert(data.get('franchise', '')) if data.get('franchise') else ''
                    manufacturer = s2t.convert(data.get('manufacturer', '')) if data.get('manufacturer') else ''

                    if not character and not franchise:
                        skipped += 1
                        del results[hpoi_id]
                        continue

                    if not franchise:
                        franchise = '待分類'
                    if not character:
                        parts = name.split(' ')
                        character = parts[1] if len(parts) > 1 else parts[0]

                    # Get or create franchise
                    fr = conn.execute(text("SELECT id FROM franchises WHERE name = :n"), {"n": franchise}).first()
                    if fr:
                        franchise_id = fr[0]
                    else:
                        r = conn.execute(text("INSERT INTO franchises (name) VALUES (:n) RETURNING id"), {"n": franchise})
                        franchise_id = r.first()[0]

                    # Get or create character
                    ch = conn.execute(text("SELECT id FROM characters WHERE name = :n AND franchise_id = :f"), {"n": character, "f": franchise_id}).first()
                    if ch:
                        character_id = ch[0]
                    else:
                        r = conn.execute(text("INSERT INTO characters (name, franchise_id) VALUES (:n, :f) RETURNING id"), {"n": character, "f": franchise_id})
                        character_id = r.first()[0]

                    # Determine retail price and currency
                    retail_price = price_cny if price_cny else price_jpy
                    retail_currency = 'CNY' if price_cny else 'JPY'

                    # Determine figure_type
                    material = data.get('material', '')
                    figure_type = s2t.convert(ft) if ft else '比例人形'
                    if material and '樹脂' in material:
                        figure_type = 'GK'

                    # Check for duplicate source_id
                    existing_by_sid = conn.execute(text(
                        "SELECT id FROM figures WHERE source_id = :sid"
                    ), {"sid": str(hpoi_id)}).first()
                    if existing_by_sid:
                        skipped += 1
                        if hpoi_id in results:
                            del results[hpoi_id]
                        continue
                    
                    # Check for potential duplicate by fuzzy name match
                    # (hand-submitted figures without source_id)
                    # Use: same manufacturer + similar character name
                    potential_dup = None
                    if manufacturer:
                        potential_dup = conn.execute(text("""
                            SELECT f.id, f.name FROM figures f
                            WHERE (f.source_id IS NULL OR f.source_id = '')
                            AND f.manufacturer = :mfr
                            AND (LOWER(f.name) LIKE :pattern1 OR LOWER(f.name) LIKE :pattern2)
                            LIMIT 1
                        """), {
                            "mfr": manufacturer,
                            "pattern1": "%" + character.lower()[:6] + "%" if character else "___NOMATCH___",
                            "pattern2": "%" + name.lower()[:10] + "%",
                        }).first()
                    
                    if potential_dup:
                        # Log it for admin review instead of auto-merging
                        logger.warning(
                            "POTENTIAL DUPLICATE: hpoi=%d name='%s' vs existing id=%d name='%s'",
                            hpoi_id, name[:40], potential_dup[0], potential_dup[1][:40]
                        )
                        # Still import it — admin can merge later
                        # But mark it with a note

                    conn.execute(text("""
                        INSERT INTO figures (name, original_name, character_id, manufacturer, scale, source_id,
                            image_url, retail_price, retail_currency, sculptor, painter, dimensions, material,
                            gender, figure_type, age_rating, release_date, reissue_dates, view_count)
                        VALUES (:name, :orig, :cid, :mfr, :scale, :sid, :img, :price, :cur, :sculptor, :painter,
                            :dim, :mat, :gender, :ft, :age, :rd, :reis, 0)
                    """), {
                        "name": name, "orig": data.get('japanese_name', ''),
                        "cid": character_id, "mfr": manufacturer,
                        "scale": data.get('scale'), "sid": str(hpoi_id),
                        "img": data.get('image_url'), "price": retail_price,
                        "cur": retail_currency, "sculptor": s2t.convert(data.get('sculptor', '') or ''),
                        "painter": s2t.convert(data.get('painter', '') or ''),
                        "dim": data.get('dimensions'), "mat": s2t.convert(material),
                        "gender": data.get('gender'), "ft": figure_type,
                        "age": s2t.convert(data.get('age_rating', '') or ''),
                        "rd": data.get('release_date'), "reis": data.get('reissue_dates'),
                    })
                    imported += 1
                except Exception as e:
                    if errors < 10:
                        logger.warning('Error importing %d: %s', hpoi_id, e)
                    errors += 1
                finally:
                    if hpoi_id in results:
                        del results[hpoi_id]

    await scraper.close()
    logger.info('DONE: imported=%d, skipped=%d, not_found=%d, errors=%d', imported, skipped, not_found, errors)

asyncio.run(main())
