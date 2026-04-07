"""Scan a range of Hpoi IDs, output to JSON file."""
import asyncio, json, logging, random, re, sys, os
sys.path.insert(0, '/app')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('scan')
from scrapers.hpoi_detail import HpoiDetailScraper

async def main():
    start_id, end_id, output_file = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    all_ids = list(range(start_id, end_id + 1))
    logger.info('Scanning IDs %d to %d (%d total)', start_id, end_id, len(all_ids))
    scraper = HpoiDetailScraper()
    results = {}
    sem = asyncio.Semaphore(5)
    async def fetch_one(hpoi_id):
        async with sem:
            data = await scraper.fetch_detail(hpoi_id)
            if data and data.get('japanese_name'):
                data['hpoi_id'] = hpoi_id
                results[hpoi_id] = data
            await asyncio.sleep(random.uniform(0.2, 0.5))
    batch_size = 200
    for i in range(0, len(all_ids), batch_size):
        batch = all_ids[i:i+batch_size]
        logger.info('Batch %d-%d of %d (found %d)', i, i+len(batch), len(all_ids), len(results))
        await asyncio.gather(*[fetch_one(h) for h in batch])
        with open(output_file, 'w') as f:
            json.dump(results, f, ensure_ascii=False)
    await scraper.close()
    logger.info('DONE: found %d figures', len(results))

asyncio.run(main())
