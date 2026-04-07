from sqlalchemy import (
    Column,
    Integer,
    Text,
    Numeric,
    Boolean,
    Date,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()


class Franchise(Base):
    __tablename__ = "franchises"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False, unique=True)
    name_zh = Column(Text)
    category = Column(Text)
    image_url = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    characters = relationship("Character", back_populates="franchise")


class Character(Base):
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    name_zh = Column(Text)
    franchise_id = Column(Integer, ForeignKey("franchises.id"), nullable=False)
    image_url = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    franchise = relationship("Franchise", back_populates="characters")
    figures = relationship("Figure", back_populates="character")


class Figure(Base):
    __tablename__ = "figures"

    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    series = Column(Text)
    manufacturer = Column(Text)
    character_id = Column(Integer, ForeignKey("characters.id"))
    version_name = Column(Text)
    scale = Column(Text)
    release_year = Column(Integer)
    jan_code = Column(Text, unique=True)
    source_id = Column(Text, unique=True)
    original_name = Column(Text)
    retail_price = Column(Integer)
    image_url = Column(Text)
    # New detail fields
    sculptor = Column(Text)
    painter = Column(Text)
    dimensions = Column(Text)
    material = Column(Text)
    gender = Column(Text)
    figure_type = Column(Text)
    age_rating = Column(Text)
    release_date = Column(Text)
    reissue_dates = Column(Text)
    view_count = Column(Integer, default=0)
    retail_currency = Column(Text)
    avg_price = Column(Numeric)
    median_price = Column(Numeric)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    character = relationship("Character", back_populates="figures")
    listings = relationship("Listing", back_populates="figure")
    price_snapshots = relationship("PriceSnapshot", back_populates="figure")
    user_reports = relationship("UserReport", back_populates="figure")


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("source", "source_id", name="uq_listing_source"),)

    id = Column(Integer, primary_key=True)
    figure_id = Column(Integer, ForeignKey("figures.id"))
    source = Column(Text, nullable=False)
    source_id = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    price = Column(Numeric, nullable=False)
    currency = Column(Text, nullable=False)
    price_usd = Column(Numeric)
    condition = Column(Text)
    is_sold = Column(Boolean, default=False)
    listed_at = Column(TIMESTAMP(timezone=True))
    sold_at = Column(TIMESTAMP(timezone=True))
    url = Column(Text)
    image_url = Column(Text)
    notes = Column(Text)
    scraped_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    figure = relationship("Figure", back_populates="listings")


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"
    __table_args__ = (UniqueConstraint("figure_id", "date", "condition", name="uq_snapshot_figure_date_cond"),)

    id = Column(Integer, primary_key=True)
    figure_id = Column(Integer, ForeignKey("figures.id"))
    date = Column(Date, nullable=False)
    avg_price = Column(Numeric)
    median_price = Column(Numeric)
    min_price = Column(Numeric)
    max_price = Column(Numeric)
    sample_count = Column(Integer)
    condition = Column(Text, default="all")

    figure = relationship("Figure", back_populates="price_snapshots")


class UserReport(Base):
    __tablename__ = "user_reports"

    id = Column(Integer, primary_key=True)
    figure_id = Column(Integer, ForeignKey("figures.id"))
    price = Column(Numeric, nullable=False)
    currency = Column(Text, nullable=False)
    condition = Column(Text)
    platform = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    notes = Column(Text)

    figure = relationship("Figure", back_populates="user_reports")


class ErrorReport(Base):
    __tablename__ = "error_reports"

    id = Column(Integer, primary_key=True)
    figure_id = Column(Integer, ForeignKey("figures.id"))
    report_type = Column(Text, default="error")
    description = Column(Text, nullable=False)
    contact = Column(Text)
    status = Column(Text, default="pending")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    reviewed_at = Column(TIMESTAMP(timezone=True))

    figure = relationship("Figure")
