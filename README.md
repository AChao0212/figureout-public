# FigureOut

PVC figure secondhand market price intelligence platform for Taiwan collectors.

**Live site:** [figureout.tw](https://figureout.tw)
**Chrome extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/bbeeniochakeccockgedlbgehmhhoknb)

## What is this?

FigureOut tracks secondhand prices for PVC collectible figures. It aggregates real transaction data from collector communities, providing market insights that help buyers and sellers make informed decisions.

- 37,000+ figures cataloged
- Real transaction price tracking
- Trending analysis (new vs historical price comparison)
- Community notes and star ratings
- Trading bulletin board (buy/sell matchmaking)
- Chrome extension for reporting prices while browsing

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, RSC), React 19, Tailwind CSS |
| Backend | FastAPI, SQLAlchemy (async), PostgreSQL 16 |
| Cache | Redis 7 |
| Scraper | Celery + Beat, Playwright |
| Infrastructure | Docker Compose, Caddy, Cloudflare |

## Architecture

```
                    Cloudflare CDN
                         |
                       Caddy
                      /     \
              Next.js:3000  FastAPI:8000
                               |
                    +---------+---------+
                    |                   |
              PostgreSQL:5432      Redis:6379
                                        |
                                  Celery Worker
```

**5 Docker services:** db, redis, api, frontend, scraper

## Features

### For Collectors
- Search 37,000+ figures by name, manufacturer, sculptor
- View secondhand price history with charts
- Track figures with watchlist (synced across devices when logged in)
- Rate figures and leave community notes
- Post buy/sell intentions on the trading board
- Report prices via the Chrome extension while browsing FB groups

### For the Platform
- User accounts with role system (user / editor / admin)
- Editor application workflow via contribution ranking
- Admin panel for figure/listing/note management
- Rate limiting and anti-scraping protection
- Structured data (JSON-LD) for SEO

## Quick Start

```bash
# Clone
git clone https://github.com/AChao0212/figureout-public.git
cd figureout-public

# Configure
cp .env.example .env
# Edit .env with your JWT_SECRET

# Run
docker compose up -d

# Site available at http://localhost:8083
# API available at http://localhost:8084
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Secret key for JWT token signing |
| `POSTGRES_PASSWORD` | No | Database password (default: figureout_dev) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (unused) |

## Project Structure

```
figureout/
  api/              # FastAPI backend
    routers/        # API endpoints (figures, browse, admin, user_auth, orders)
    db/             # SQLAlchemy models
    auth.py         # JWT authentication
  frontend/         # Next.js frontend
    src/app/        # Pages (12 routes)
    src/components/ # React components
  scraper/          # Celery worker
    scrapers/       # Hpoi, Yahoo Auction, Mercari, Rakuma
  tools/            # Standalone scripts for data import
  docker-compose.yml
```

## License

This project is source-available for educational and portfolio purposes. Commercial use or redistribution of the codebase requires permission.

Data displayed on figureout.tw is community-contributed and publicly accessible.
