from datetime import date, datetime

from sqlalchemy import (
    Index,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Franchise(Base):
    __tablename__ = "franchises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    name_zh: Mapped[str | None] = mapped_column(String(300))  # Traditional Chinese name
    category: Mapped[str | None] = mapped_column(String(100))  # e.g. "遊戲", "動畫", "虛擬歌手"
    image_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    characters: Mapped[list["Character"]] = relationship(back_populates="franchise")


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_zh: Mapped[str | None] = mapped_column(String(300))  # e.g. "初音未來"
    franchise_id: Mapped[int] = mapped_column(Integer, ForeignKey("franchises.id"), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    franchise: Mapped["Franchise"] = relationship(back_populates="characters")
    figures: Mapped[list["Figure"]] = relationship(back_populates="character")


class Figure(Base):
    __tablename__ = "figures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    series: Mapped[str | None] = mapped_column(String(300))
    manufacturer: Mapped[str | None] = mapped_column(String(300))
    character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"))
    # franchise_id is denormalised onto figure for two reasons:
    #  - editors want to batch-edit franchise independently of character (their
    #    mental model and how every figure DB stores it).
    #  - lets us have figures with known franchise but unknown character.
    # Initially backfilled from character.franchise_id (kept in sync by
    # admin_update_figure / batch endpoints when character changes), but editors
    # CAN deliberately have them drift if they need to.
    franchise_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("franchises.id"))
    version_name: Mapped[str | None] = mapped_column(String(500))  # e.g. "feat. 米山舞", "Happy 16th Birthday"
    scale: Mapped[str | None] = mapped_column(String(50))
    release_year: Mapped[int | None] = mapped_column(Integer)
    jan_code: Mapped[str | None] = mapped_column(String(50), unique=True)
    source_id: Mapped[int | None] = mapped_column(Integer, unique=True)
    original_name: Mapped[str | None] = mapped_column(Text)
    retail_price: Mapped[int | None] = mapped_column(Integer)
    retail_currency: Mapped[str | None] = mapped_column(String(10), default="JPY")
    image_url: Mapped[str | None] = mapped_column(Text)
    # Detail fields from Hpoi
    sculptor: Mapped[str | None] = mapped_column(Text)
    painter: Mapped[str | None] = mapped_column(Text)
    # Illustrator / 原画 — character designer / original artwork artist (often
    # distinct from sculptor; e.g. Nardack draws the design, someone else
    # sculpts). Not on Hpoi as a per-figure attribute so this lives on the
    # editor/submitter path, not the enrich-from-Hpoi path.
    illustrator: Mapped[str | None] = mapped_column(Text)
    dimensions: Mapped[str | None] = mapped_column(Text)
    material: Mapped[str | None] = mapped_column(Text)
    gender: Mapped[str | None] = mapped_column(Text)
    figure_type: Mapped[str | None] = mapped_column(Text)
    age_rating: Mapped[str | None] = mapped_column(Text)
    release_date: Mapped[str | None] = mapped_column(Text)
    reissue_dates: Mapped[str | None] = mapped_column(Text)
    # External reference to hpoi.net entry, kept as a hint for editors/admins.
    hpoi_link: Mapped[str | None] = mapped_column(Text)
    # Manufacturer's official product page URL — editor-curated.
    official_url: Mapped[str | None] = mapped_column(Text)
    view_count: Mapped[int | None] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    character: Mapped["Character | None"] = relationship(back_populates="figures")
    franchise: Mapped["Franchise | None"] = relationship(foreign_keys=[franchise_id])
    listings: Mapped[list["Listing"]] = relationship(back_populates="figure")
    price_snapshots: Mapped[list["PriceSnapshot"]] = relationship(
        back_populates="figure"
    )
    user_reports: Mapped[list["UserReport"]] = relationship(back_populates="figure")


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_listing_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    figure_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("figures.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(500))
    price: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str | None] = mapped_column(String(10))
    price_canonical: Mapped[float | None] = mapped_column(Float)
    condition: Mapped[str | None] = mapped_column(String(50))
    is_sold: Mapped[bool] = mapped_column(Boolean, default=False)
    listed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    url: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    figure: Mapped["Figure"] = relationship(back_populates="listings")


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"
    __table_args__ = (
        UniqueConstraint("figure_id", "date", "condition", name="uq_snapshot_figure_date_cond"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    figure_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("figures.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    avg_price: Mapped[float | None] = mapped_column(Float)
    median_price: Mapped[float | None] = mapped_column(Float)
    min_price: Mapped[float | None] = mapped_column(Float)
    max_price: Mapped[float | None] = mapped_column(Float)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    condition: Mapped[str | None] = mapped_column(String(50), default="all")

    figure: Mapped["Figure"] = relationship(back_populates="price_snapshots")


class UserReport(Base):
    __tablename__ = "user_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    figure_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("figures.id"), nullable=False
    )
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False)
    condition: Mapped[str | None] = mapped_column(String(50))
    platform: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    figure: Mapped["Figure"] = relationship(back_populates="user_reports")


class FigureSubmission(Base):
    __tablename__ = "figure_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Submitted info
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    character_name: Mapped[str | None] = mapped_column(String(300))
    franchise_name: Mapped[str | None] = mapped_column(String(300))
    manufacturer: Mapped[str | None] = mapped_column(String(300))
    version_name: Mapped[str | None] = mapped_column(String(500))
    scale: Mapped[str | None] = mapped_column(String(50))
    jan_code: Mapped[str | None] = mapped_column(String(50))
    image_url: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    retail_price: Mapped[int | None] = mapped_column(Integer)
    retail_currency: Mapped[str | None] = mapped_column(String(10), default="JPY")
    figure_type: Mapped[str | None] = mapped_column(Text)
    age_rating: Mapped[str | None] = mapped_column(Text)
    material: Mapped[str | None] = mapped_column(Text)
    original_name: Mapped[str | None] = mapped_column(Text)
    series: Mapped[str | None] = mapped_column(String(300))
    sculptor: Mapped[str | None] = mapped_column(Text)
    painter: Mapped[str | None] = mapped_column(Text)
    illustrator: Mapped[str | None] = mapped_column(Text)
    dimensions: Mapped[str | None] = mapped_column(Text)
    gender: Mapped[str | None] = mapped_column(Text)
    release_date: Mapped[str | None] = mapped_column(Text)
    # Optional hpoi.net reference URL provided by the submitter.
    hpoi_link: Mapped[str | None] = mapped_column(Text)
    # Manufacturer's official product page URL provided by the submitter.
    official_url: Mapped[str | None] = mapped_column(Text)
    # Review status
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, approved, rejected
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ErrorReport(Base):
    __tablename__ = "error_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    figure_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("figures.id"))
    report_type: Mapped[str] = mapped_column(String(50), default="error")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    figure: Mapped["Figure | None"] = relationship()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    google_id: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(300), unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    username: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    trust_score: Mapped[int] = mapped_column(Integer, default=100)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    orders: Mapped[list["Order"]] = relationship(back_populates="user")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="user")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    figure_id: Mapped[int] = mapped_column(Integer, ForeignKey("figures.id"), nullable=False)
    order_type: Mapped[str] = mapped_column(String(10), nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(10))
    condition: Mapped[str] = mapped_column(String(50), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")
    matched_with_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("orders.id"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="orders")
    figure: Mapped["Figure"] = relationship()


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    buy_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("orders.id"), nullable=False)
    sell_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("orders.id"), nullable=False)
    figure_id: Mapped[int] = mapped_column(Integer, ForeignKey("figures.id"), nullable=False)
    match_price: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    buy_order: Mapped["Order"] = relationship(foreign_keys=[buy_order_id])
    sell_order: Mapped["Order"] = relationship(foreign_keys=[sell_order_id])
    figure: Mapped["Figure"] = relationship()


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    data_json: Mapped[str | None] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="notifications")
