"""Scan a range of Hpoi IDs - designed to run multiple instances in parallel."""
import asyncio
import logging
import random
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('scan_worker')

from sqlalchemy import create_engine, text
from opencc import OpenCC

DB_URL = os.environ.get('DATABASE_URL_SYNC', 'postgresql://figureout:figureout_dev@db:5432/figureout')
SCAN_START = int(os.environ.get('SCAN_START', '1'))
SCAN_END = int(os.environ.get('SCAN_END', '126392'))
s2t = OpenCC('s2t')

MIN_JPY = 3700
MIN_CNY = 180

async def main():
    from scrapers.hpoi_detail import HpoiDetailScraper

    engine = create_engine(DB_URL)

    with engine.begin() as conn:
        rows = conn.execute(text("SELECT source_id FROM figures WHERE source_id IS NOT NULL")).all()
    existing_ids = set(int(r[0]) for r in rows if r[0] and r[0].isdigit())

    all_ids = sorted(set(range(SCAN_START, SCAN_END + 1)) - existing_ids)
    logger.info('Worker range %d-%d: scanning %d missing IDs', SCAN_START, SCAN_END, len(all_ids))

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

    batch_size = 200
    for i in range(0, len(all_ids), batch_size):
        batch = all_ids[i:i+batch_size]
        logger.info('Batch %d-%d of %d (imported=%d, skipped=%d, 404=%d, errors=%d)',
                     i, i+len(batch), len(all_ids), imported, skipped, not_found, errors)

        tasks = [fetch_one(hid) for hid in batch]
        await asyncio.gather(*tasks)

        with engine.begin() as conn:
            for hpoi_id, data in list(results.items()):
                try:
                    ft = data.get('figure_type', '')
                    if ft and ft not in ('比例人形', 'Q版人形', '拼裝人形'):
                        skipped += 1
                        del results[hpoi_id]
                        continue

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

                    # Dedup check
                    existing = conn.execute(text("SELECT id FROM figures WHERE source_id = :sid"), {"sid": str(hpoi_id)}).first()
                    if existing:
                        skipped += 1
                        del results[hpoi_id]
                        continue

                    # Get or create franchise
                    fr = conn.execute(text("SELECT id FROM franchises WHERE name = :n"), {"n": franchise}).first()
                    if fr:
                        franchise_id = fr[0]
                    else:
                        r = conn.execute(text("INSERT INTO franchises (name) VALUES (:n) RETURNING id"), {"n": franchise})
                        franchise_id = r.first()[0]

                    ch = conn.execute(text("SELECT id FROM characters WHERE name = :n AND franchise_id = :f"), {"n": character, "f": franchise_id}).first()
                    if ch:
                        character_id = ch[0]
                    else:
                        r = conn.execute(text("INSERT INTO characters (name, franchise_id) VALUES (:n, :f) RETURNING id"), {"n": character, "f": franchise_id})
                        character_id = r.first()[0]

                    retail_price = price_cny if price_cny else price_jpy
                    retail_currency = 'CNY' if price_cny else 'JPY'
                    material = data.get('material', '')
                    figure_type = s2t.convert(ft) if ft else '比例人形'
                    if material and '樹脂' in material:
                        figure_type = 'GK'

                    # Log potential duplicates with hand-submitted figures
                    if manufacturer:
                        dup = conn.execute(text("""
                            SELECT id, name FROM figures
                            WHERE (source_id IS NULL OR source_id = '')
                            AND manufacturer = :mfr AND LOWER(name) LIKE :p
                            LIMIT 1
                        """), {"mfr": manufacturer, "p": "%" + character.lower()[:6] + "%" if character else "___"}).first()
                        if dup:
                            logger.warning('POTENTIAL DUPLICATE: hpoi=%d "%s" vs id=%d "%s"', hpoi_id, name[:40], dup[0], dup[1][:40])

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
    logger.info('DONE: range=%d-%d imported=%d skipped=%d not_found=%d errors=%d', SCAN_START, SCAN_END, imported, skipped, not_found, errors)

asyncio.run(main())
