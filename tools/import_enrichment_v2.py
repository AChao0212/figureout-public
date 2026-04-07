#!/usr/bin/env python3
"""
Import Hpoi enrichment results into the database.
V2: Also handles manufacturer, character, and franchise assignment.

Usage:
    DATABASE_URL=postgresql://figureout:${POSTGRES_PASSWORD}@db:5432/figureout python3 import_enrichment_v2.py enriched_results.json
"""

import json
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("import_enrichment")

try:
    from sqlalchemy import create_engine, text
except ImportError:
    logger.error("sqlalchemy not installed. Run: pip install sqlalchemy psycopg2-binary")
    sys.exit(1)

# Simplified Chinese to Traditional Chinese map for common terms
# (in case opencc not available in scraper container)
try:
    from opencc import OpenCC
    _s2t = OpenCC("s2t")
    def to_trad(s): return _s2t.convert(s) if s else s
except ImportError:
    def to_trad(s): return s


def get_or_create_franchise(conn, name):
    """Find or create a franchise by name, return id."""
    if not name or name.strip() == "":
        return None
    name = name.strip()
    result = conn.execute(text("SELECT id FROM franchises WHERE name = :n"), {"n": name})
    row = result.one_or_none()
    if row:
        return row.id
    result = conn.execute(
        text("INSERT INTO franchises (name) VALUES (:n) RETURNING id"),
        {"n": name}
    )
    return result.one().id


def get_or_create_character(conn, name, franchise_id):
    """Find or create a character by name + franchise, return id."""
    if not name or name.strip() == "":
        return None
    name = name.strip()
    if franchise_id:
        result = conn.execute(
            text("SELECT id FROM characters WHERE name = :n AND franchise_id = :fid"),
            {"n": name, "fid": franchise_id}
        )
        row = result.one_or_none()
        if row:
            return row.id
    else:
        result = conn.execute(
            text("SELECT id FROM characters WHERE name = :n LIMIT 1"),
            {"n": name}
        )
        row = result.one_or_none()
        if row:
            return row.id

    # Create new character
    fid = franchise_id
    if not fid:
        # Create placeholder franchise
        fid = get_or_create_franchise(conn, name)
    result = conn.execute(
        text("INSERT INTO characters (name, franchise_id) VALUES (:n, :fid) RETURNING id"),
        {"n": name, "fid": fid}
    )
    return result.one().id


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <enriched_results.json>")
        sys.exit(1)

    json_path = sys.argv[1]
    db_url = os.environ.get("DATABASE_URL", "postgresql://figureout:${POSTGRES_PASSWORD}@db:5432/figureout")

    with open(json_path, "r", encoding="utf-8") as f:
        results = json.load(f)

    logger.info("Loaded %d enrichment results from %s", len(results), json_path)

    engine = create_engine(db_url)
    updated = 0
    char_fixed = 0
    skipped = 0
    errors = 0

    # Cache for franchise/character IDs
    franchise_cache = {}
    character_cache = {}

    # First pass: identify which figures are in 待分類
    with engine.begin() as conn:
        uncategorized_result = conn.execute(text(
            "SELECT f.id FROM figures f "
            "JOIN characters c ON f.character_id = c.id "
            "JOIN franchises fr ON c.franchise_id = fr.id "
            "WHERE fr.name = '待分類'"
        ))
        uncategorized_ids = {row.id for row in uncategorized_result.all()}
        logger.info("Found %d figures in 待分類", len(uncategorized_ids))

        no_mfr_result = conn.execute(text(
            "SELECT id FROM figures WHERE manufacturer IS NULL OR manufacturer = ''"
        ))
        no_mfr_ids = {row.id for row in no_mfr_result.all()}
        logger.info("Found %d figures with no manufacturer", len(no_mfr_ids))

    with engine.begin() as conn:
        for fig_id_str, data in results.items():
            fig_id = int(fig_id_str)
            try:
                updates = {}

                # Basic fields
                if data.get("image_url"):
                    updates["image_url"] = data["image_url"]
                if data.get("sculptor"):
                    updates["sculptor"] = data["sculptor"]
                if data.get("painter"):
                    updates["painter"] = data["painter"]
                if data.get("dimensions"):
                    updates["dimensions"] = data["dimensions"]
                if data.get("material"):
                    updates["material"] = data["material"]
                if data.get("gender"):
                    updates["gender"] = data["gender"]
                if data.get("figure_type"):
                    updates["figure_type"] = data["figure_type"]
                if data.get("age_rating"):
                    updates["age_rating"] = data["age_rating"]
                if data.get("scale"):
                    updates["scale"] = data["scale"]
                if data.get("price_jpy"):
                    updates["retail_price"] = data["price_jpy"]
                if data.get("release_date"):
                    updates["release_date"] = data["release_date"]
                if data.get("reissue_dates"):
                    updates["reissue_dates"] = data["reissue_dates"]
                if data.get("japanese_name"):
                    updates["original_name"] = data["japanese_name"]

                # V2: Update manufacturer if missing
                if data.get("manufacturer") and fig_id in no_mfr_ids:
                    mfr = to_trad(data["manufacturer"].strip())
                    if mfr:
                        updates["manufacturer"] = mfr

                # V2: Fix character/franchise if figure is in 待分類
                if fig_id in uncategorized_ids:
                    franchise_name = data.get("franchise", "").strip()
                    character_name = data.get("character", "").strip()

                    if franchise_name:
                        franchise_name = to_trad(franchise_name)
                        if franchise_name not in franchise_cache:
                            franchise_cache[franchise_name] = get_or_create_franchise(conn, franchise_name)
                        fran_id = franchise_cache[franchise_name]

                        if character_name:
                            character_name = to_trad(character_name)
                            cache_key = f"{character_name}_{fran_id}"
                            if cache_key not in character_cache:
                                character_cache[cache_key] = get_or_create_character(conn, character_name, fran_id)
                            char_id = character_cache[cache_key]
                            updates["character_id"] = char_id
                            char_fixed += 1
                        elif fran_id:
                            # No character but has franchise — create a generic character
                            cache_key = f"_generic_{fran_id}"
                            if cache_key not in character_cache:
                                character_cache[cache_key] = get_or_create_character(conn, franchise_name, fran_id)
                            updates["character_id"] = character_cache[cache_key]
                            char_fixed += 1
                    elif character_name:
                        character_name = to_trad(character_name)
                        cache_key = f"{character_name}_none"
                        if cache_key not in character_cache:
                            character_cache[cache_key] = get_or_create_character(conn, character_name, None)
                        updates["character_id"] = character_cache[cache_key]
                        char_fixed += 1

                if not updates:
                    skipped += 1
                    continue

                set_parts = ", ".join(f"{k} = :{k}" for k in updates)
                sql = text(f"UPDATE figures SET {set_parts} WHERE id = :fig_id")
                updates["fig_id"] = fig_id
                conn.execute(sql, updates)
                updated += 1

                if (updated + skipped + errors) % 500 == 0:
                    logger.info("Progress: %d updated (%d char/fran fixed), %d skipped, %d errors",
                                updated, char_fixed, skipped, errors)

            except Exception as e:
                errors += 1
                if errors <= 10:
                    logger.warning("Error updating figure %d: %s", fig_id, e)

    logger.info("Import complete: %d updated, %d char/franchise fixed, %d skipped, %d errors",
                updated, char_fixed, skipped, errors)


if __name__ == "__main__":
    main()
