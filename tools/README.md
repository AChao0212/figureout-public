# Figurein Standalone Scraper Tools

Standalone scraper scripts that can run on any machine without Celery/Redis.

## Setup

```bash
pip install httpx beautifulsoup4 sqlalchemy psycopg2-binary
```

## standalone_scraper.py

Scrapes Yahoo Auctions Japan and/or Mercari for completed figure sales.

### Direct mode (DB accessible from this machine)

```bash
export DATABASE_URL="postgresql://figureout:${POSTGRES_PASSWORD}@<SERVER_IP>:5432/figuerin"

# Yahoo Auctions (default), 200 figures, 5 concurrent
python standalone_scraper.py --mode direct --batch-size 50 --max-figures 200

# Mercari
python standalone_scraper.py --mode direct --source mercari --batch-size 30 --max-figures 100

# Both sources
python standalone_scraper.py --mode direct --source both --batch-size 30 --max-figures 100
```

### Export mode (for separate machines without DB access)

```bash
export DATABASE_URL="postgresql://figureout:${POSTGRES_PASSWORD}@<SERVER_IP>:5432/figuerin"

# Step 1: Scrape and save to JSON
python standalone_scraper.py --mode export --batch-size 50 --max-figures 200 -o results.json

# Step 2: Transfer file to server
scp results.json <USER>@<SERVER_IP>:/tmp/

# Step 3: Import on server
python import_results.py /tmp/results.json
```

### Using a pre-exported figures list (no DB needed for scraping)

```bash
# First, export figures from DB on the server:
# psql -d figuerin -c "COPY (SELECT id, name, name_ja, scale, figure_type, retail_price, manufacturer FROM figures WHERE image_url IS NOT NULL AND name_ja IS NOT NULL AND retail_price IS NOT NULL LIMIT 200) TO STDOUT WITH CSV HEADER" > figures.csv

# Or create figures.json manually:
# [{"id": 1, "name": "...", "name_ja": "...", "scale": "1/7", "figure_type": null, "retail_price": 15000}, ...]

python standalone_scraper.py --mode export --figures-json figures.json -o results.json
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--mode` | `export` | `direct` (write DB) or `export` (save JSON) |
| `--source` | `yahoo` | `yahoo`, `mercari`, or `both` |
| `--batch-size` | `50` | Figures per concurrent batch |
| `--max-figures` | `200` | Max figures to scrape |
| `--concurrency` | `5` | Max concurrent HTTP requests |
| `--database-url` | `$DATABASE_URL` | PostgreSQL connection string |
| `-o` / `--output` | `results.json` | Output file for export mode |
| `--figures-json` | | Load figures from JSON instead of DB |

## import_results.py

Imports a `results.json` file into the database.

```bash
export DATABASE_URL="postgresql://figureout:${POSTGRES_PASSWORD}@<SERVER_IP>:5432/figuerin"

# Dry run (preview what would be imported)
python import_results.py results.json --dry-run

# Import for real
python import_results.py results.json
```

## Rate Limiting

- Default concurrency: 5 concurrent requests
- Each figure search waits 4-8 seconds between requests
- Empty results wait 3-6 seconds
- Yahoo Auctions results are filtered to >= 3000 JPY
- Price sanity: listings outside 5%-500% of retail price are skipped
