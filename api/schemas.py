from datetime import date, datetime

from typing import Literal
from pydantic import BaseModel, ConfigDict


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    title: str | None = None
    price: float | None = None
    currency: str | None = None
    price_usd: float | None = None
    condition: str | None = None
    is_sold: bool = False
    sold_at: datetime | None = None
    url: str | None = None
    image_url: str | None = None
    notes: str | None = None


class PriceSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    avg_price: float | None = None
    median_price: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    sample_count: int = 0


class ConditionPriceOut(BaseModel):
    condition: str  # "sealed" or "opened"
    condition_label: str  # "全新未拆" or "已拆擺設"
    avg_price: float | None = None
    median_price: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    sample_count: int = 0


class FranchiseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    name_zh: str | None = None
    category: str | None = None
    image_url: str | None = None
    notes: str | None = None


class CharacterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    name_zh: str | None = None
    franchise: FranchiseOut | None = None
    image_url: str | None = None
    notes: str | None = None


class FigureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    series: str | None = None
    manufacturer: str | None = None
    scale: str | None = None
    release_year: int | None = None
    image_url: str | None = None
    notes: str | None = None
    version_name: str | None = None
    original_name: str | None = None
    retail_price: int | None = None
    retail_currency: str | None = "JPY"
    sculptor: str | None = None
    painter: str | None = None
    dimensions: str | None = None
    material: str | None = None
    gender: str | None = None
    figure_type: str | None = None
    age_rating: str | None = None
    release_date: str | None = None
    reissue_dates: str | None = None
    character_name: str | None = None
    franchise_name: str | None = None
    current_avg_price: float | None = None
    current_median_price: float | None = None
    price_change_pct: float | None = None  # % change vs retail price
    price_trend_pct: float | None = None  # % change recent price trend (EMA-based)


class FigureRelated(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    image_url: str | None = None
    notes: str | None = None
    manufacturer: str | None = None
    retail_price: int | None = None
    retail_currency: str | None = "JPY"
    current_median_price: float | None = None
    price_change_pct: float | None = None


class FigureDetail(FigureOut):
    rating_avg: float | None = None
    rating_count: int = 0
    recent_listings: list[ListingOut] = []
    price_history: list[PriceSnapshotOut] = []
    price_history_by_condition: dict[str, list[PriceSnapshotOut]] = {}
    condition_prices: list[ConditionPriceOut] = []
    related_figures: list[FigureRelated] = []


class CharacterWithFigures(CharacterOut):
    figures: list[FigureOut] = []


class PriceReportIn(BaseModel):
    price: int
    currency: Literal["TWD", "JPY", "USD", "CNY"] = "TWD"
    condition: Literal["sealed", "opened", "used", "damaged"] | None = None
    platform: str | None = None
    notes: str | None = None
    sold_at: str | None = None  # ISO date string, e.g. 2026-03-20


class SearchResult(BaseModel):
    figures: list[FigureOut] = []
    total: int = 0


class FigureSubmissionIn(BaseModel):
    name: str
    retail_currency: str | None = "JPY"
    original_name: str | None = None
    character_name: str | None = None
    franchise_name: str | None = None
    manufacturer: str | None = None
    version_name: str | None = None
    series: str | None = None
    scale: str | None = None
    jan_code: str | None = None
    image_url: str | None = None
    notes: str | None = None
    notes: str | None = None
    retail_price: int | None = None
    figure_type: str | None = None
    age_rating: str | None = None
    material: str | None = None
    sculptor: str | None = None
    painter: str | None = None
    dimensions: str | None = None
    gender: str | None = None
    release_date: str | None = None


class FigureSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    character_name: str | None = None
    franchise_name: str | None = None
    manufacturer: str | None = None
    version_name: str | None = None
    scale: str | None = None
    status: str
    created_at: datetime


class ErrorReportIn(BaseModel):
    figure_id: int | None = None
    report_type: str = "error"  # error, wrong_info, missing, duplicate, other, wrong_price, wrong_item  # error, wrong_info, missing, duplicate, other
    description: str
    contact: str | None = None


class ErrorReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    figure_id: int | None = None
    report_type: str
    description: str
    contact: str | None = None
    status: str
    created_at: datetime


class FigureSubmitIn(BaseModel):
    name: str
    franchise_name: str | None = None
    character_name: str | None = None
    manufacturer: str | None = None
    scale: str | None = None
    image_url: str | None = None
    notes: str | None = None
    notes: str | None = None
    retail_price: int | None = None
    figure_type: str | None = None
    age_rating: str | None = None
    material: str | None = None
