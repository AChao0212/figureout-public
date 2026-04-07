"""Seed the database with sample figures for development/testing."""

import os
import sys
from datetime import date, timedelta
from random import gauss, randint

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from db.models import Base, Character, Figure, Franchise, Listing, PriceSnapshot

DATABASE_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://figureout:figureout_dev@localhost:5432/figureout",
)

SEED_DATA = [
    {
        "franchise": {"name": "Vocaloid", "name_zh": "虛擬歌手", "category": "虛擬歌手"},
        "characters": [
            {
                "name": "Hatsune Miku", "name_zh": "初音未來",
                "figures": [
                    {"version_name": "feat. 米山舞", "manufacturer": "Good Smile Company", "scale": "1/7", "release_year": 2023, "base_price": 120},
                    {"version_name": "Happy 16th Birthday Ver.", "manufacturer": "Good Smile Company", "scale": "1/7", "release_year": 2024, "base_price": 95},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Azur Lane", "name_zh": "碧藍航線", "category": "遊戲"},
        "characters": [
            {
                "name": "Taihou", "name_zh": "大鳳",
                "figures": [
                    {"version_name": "碧海微風 Ver.", "manufacturer": "Alter", "scale": "1/7", "release_year": 2023, "base_price": 180},
                ]
            },
            {
                "name": "Atago", "name_zh": "愛宕",
                "figures": [
                    {"version_name": "輕裝 Ver.", "manufacturer": "Hobby Max", "scale": "1/7", "release_year": 2022, "base_price": 150},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Arknights", "name_zh": "明日方舟", "category": "遊戲"},
        "characters": [
            {
                "name": "Amiya", "name_zh": "阿米婭",
                "figures": [
                    {"version_name": "升變 Ver.", "manufacturer": "Good Smile Company", "scale": "1/7", "release_year": 2024, "base_price": 110},
                ]
            },
            {
                "name": "W", "name_zh": "W",
                "figures": [
                    {"version_name": "狂獵 Ver.", "manufacturer": "Myethos", "scale": "1/7", "release_year": 2023, "base_price": 160},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Re:Zero", "name_zh": "Re:從零開始的異世界生活", "category": "動畫"},
        "characters": [
            {
                "name": "Rem", "name_zh": "雷姆",
                "figures": [
                    {"version_name": "鬼族之夜 Ver.", "manufacturer": "Good Smile Company", "scale": "1/7", "release_year": 2022, "base_price": 130},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Fate Series", "name_zh": "Fate 系列", "category": "遊戲"},
        "characters": [
            {
                "name": "Saber Artoria", "name_zh": "阿爾托莉雅",
                "figures": [
                    {"version_name": "Excalibur Ver.", "manufacturer": "Alter", "scale": "1/7", "release_year": 2022, "base_price": 190},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Spy x Family", "name_zh": "間諜家家酒", "category": "動畫"},
        "characters": [
            {
                "name": "Anya Forger", "name_zh": "安妮亞",
                "figures": [
                    {"version_name": "わくわく Ver.", "manufacturer": "Good Smile Company", "scale": "1/7", "release_year": 2024, "base_price": 85},
                ]
            },
        ]
    },
    {
        "franchise": {"name": "Chainsaw Man", "name_zh": "鏈鋸人", "category": "動畫"},
        "characters": [
            {
                "name": "Power", "name_zh": "乘力",
                "figures": [
                    {"version_name": "血之魔人 Ver.", "manufacturer": "FREEing", "scale": "1/7", "release_year": 2024, "base_price": 140},
                ]
            },
        ]
    },
]


def seed():
    engine = create_engine(DATABASE_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with Session(engine) as session:

        today = date.today()
        figure_count = 0

        for entry in SEED_DATA:
            # Create franchise
            franchise = Franchise(**entry["franchise"])
            session.add(franchise)
            session.flush()

            for char_data in entry["characters"]:
                # Create character
                character = Character(
                    name=char_data["name"],
                    name_zh=char_data["name_zh"],
                    franchise_id=franchise.id,
                )
                session.add(character)
                session.flush()

                for fig_data in char_data["figures"]:
                    base_price = fig_data["base_price"]
                    fig_name = f"{char_data['name_zh']} {fig_data['version_name']} {fig_data['scale']}"

                    figure = Figure(
                        name=fig_name,
                        series=entry["franchise"]["name"],
                        manufacturer=fig_data["manufacturer"],
                        character_id=character.id,
                        version_name=fig_data["version_name"],
                        scale=fig_data["scale"],
                        release_year=fig_data["release_year"],
                    )
                    session.add(figure)
                    session.flush()
                    figure_count += 1

                    # Generate 90 days of price snapshots with slight random walk
                    price = base_price
                    for day_offset in range(90, 0, -1):
                        snap_date = today - timedelta(days=day_offset)
                        price = max(10, price + gauss(0, base_price * 0.02))
                        session.add(
                            PriceSnapshot(
                                figure_id=figure.id,
                                date=snap_date,
                                avg_price=round(price, 2),
                                median_price=round(price * 0.97, 2),
                                min_price=round(price * 0.75, 2),
                                max_price=round(price * 1.25, 2),
                                sample_count=randint(3, 20),
                            )
                        )

                    # Generate sample listings
                    sources = ["mercari_jp", "yahoo_jp"]
                    listing_variants = [
                        ("new", "未開封・新品", 1.25),
                        ("new", "全新未拆", 1.20),
                        ("good", "中古美品", 1.0),
                        ("good", "已拆擺設", 0.95),
                        ("like_new", "開封確認のみ", 1.10),
                        ("good", "中古", 0.90),
                        ("new", "sealed", 1.30),
                        ("fair", "訳あり", 0.70),
                    ]
                    for j, (cond, label, price_mult) in enumerate(listing_variants):
                        listing_price_jpy = round(
                            price * 150 * price_mult * (1.0 + gauss(0, 0.05)), 0
                        )
                        session.add(
                            Listing(
                                figure_id=figure.id,
                                source=sources[j % 2],
                                source_id=f"seed_{figure.id}_{j}",
                                title=f"{fig_name} - {label}",
                                price=listing_price_jpy,
                                currency="JPY",
                                price_usd=round(listing_price_jpy * 0.0067, 2),
                                condition=cond,
                                is_sold=True,
                                sold_at=today - timedelta(days=randint(1, 30)),
                            )
                        )

        session.commit()
        print(f"Seeded {figure_count} figures with price history and listings.")


if __name__ == "__main__":
    seed()
