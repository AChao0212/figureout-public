import re
from datetime import date, datetime

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


Currency = Literal["TWD", "JPY", "USD", "CNY"]
Condition = Literal["sealed", "opened", "used", "damaged"]


def _validate_http_url(v: str | None) -> str | None:
    """Normalise a user-entered URL. Be forgiving about a missing scheme —
    editors routinely paste a bare domain like "goodsmile.com/x" and we should
    treat that as https:// rather than rejecting it. But still reject dangerous
    pseudo-schemes (javascript:, data:, vbscript:) and non-web schemes (ftp:)."""
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    # Already has an explicit scheme://  → must be http(s), else reject.
    m = re.match(r"^([a-zA-Z][a-zA-Z0-9+.\-]*)://", v)
    if m:
        if m.group(1).lower() not in ("http", "https"):
            raise ValueError("網址必須以 http:// 或 https:// 開頭")
        return v
    # No "scheme://". Guard against pseudo-schemes that use "scheme:" without
    # "//" (javascript:alert(1), data:text/html,...). A domain with a port
    # ("example.com:8080") also has a colon, but its prefix contains a dot,
    # so we only reject when the colon-prefix has no dot (i.e. looks like a scheme).
    m2 = re.match(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):", v)
    if m2 and "." not in m2.group(1):
        raise ValueError("網址必須以 http:// 或 https:// 開頭")
    # Bare domain (optionally with path/port) → assume https://.
    return "https://" + v


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    title: str | None = None
    price: float | None = None
    currency: str | None = None
    price_canonical: float | None = None
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
    illustrator: str | None = None
    dimensions: str | None = None
    material: str | None = None
    gender: str | None = None
    figure_type: str | None = None
    age_rating: str | None = None
    release_date: str | None = None
    reissue_dates: str | None = None
    hpoi_link: str | None = None
    official_url: str | None = None
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
    # Retail price already converted to display currency (e.g. JPY 17919 → TWD 3860 at live rate).
    # Original `retail_price` and `retail_currency` kept for the parenthetical reference label.
    retail_price_display: float | None = None
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
    name: str = Field(..., max_length=500, min_length=1)
    retail_currency: Currency | None = "JPY"
    original_name: str | None = Field(None, max_length=500)
    character_name: str | None = Field(None, max_length=300)
    franchise_name: str | None = Field(None, max_length=300)
    manufacturer: str | None = Field(None, max_length=300)
    version_name: str | None = Field(None, max_length=500)
    series: str | None = Field(None, max_length=300)
    scale: str | None = Field(None, max_length=50)
    jan_code: str | None = Field(None, max_length=50)
    image_url: str | None = Field(None, max_length=1000)
    notes: str | None = Field(None, max_length=2000)
    retail_price: int | None = Field(None, ge=0, le=10_000_000)
    figure_type: str | None = Field(None, max_length=50)
    age_rating: str | None = Field(None, max_length=50)
    material: str | None = Field(None, max_length=100)
    sculptor: str | None = Field(None, max_length=500)
    painter: str | None = Field(None, max_length=500)
    illustrator: str | None = Field(None, max_length=500)
    dimensions: str | None = Field(None, max_length=200)
    gender: str | None = Field(None, max_length=20)
    release_date: str | None = Field(None, max_length=50)
    # Optional reference URL on hpoi.net so reviewers can verify against the canonical entry.
    hpoi_link: str | None = Field(None, max_length=500)
    # Manufacturer's official product page URL.
    official_url: str | None = Field(None, max_length=1000)

    @field_validator("image_url")
    @classmethod
    def _check_image_url(cls, v):
        return _validate_http_url(v)

    @field_validator("hpoi_link")
    @classmethod
    def _check_hpoi_link(cls, v):
        return _validate_http_url(v)

    @field_validator("official_url")
    @classmethod
    def _check_official_url(cls, v):
        return _validate_http_url(v)


class FigureSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    character_name: str | None = None
    franchise_name: str | None = None
    manufacturer: str | None = None
    version_name: str | None = None
    scale: str | None = None
    hpoi_link: str | None = None
    illustrator: str | None = None
    official_url: str | None = None
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
    illustrator: str | None = None
    official_url: str | None = None


# ── Admin input models (for validation) ─────────────────────────────

class AdminFigureUpdate(BaseModel):
    name: str | None = Field(None, max_length=500, min_length=1)
    original_name: str | None = Field(None, max_length=500)
    manufacturer: str | None = Field(None, max_length=300)
    scale: str | None = Field(None, max_length=50)
    retail_price: int | None = Field(None, ge=0, le=10_000_000)
    retail_currency: Currency | None = None
    image_url: str | None = Field(None, max_length=1000)
    sculptor: str | None = Field(None, max_length=500)
    painter: str | None = Field(None, max_length=500)
    illustrator: str | None = Field(None, max_length=500)
    dimensions: str | None = Field(None, max_length=200)
    material: str | None = Field(None, max_length=100)
    gender: str | None = Field(None, max_length=20)
    figure_type: str | None = Field(None, max_length=50)
    age_rating: str | None = Field(None, max_length=50)
    release_date: str | None = Field(None, max_length=50)
    reissue_dates: str | None = Field(None, max_length=200)
    hpoi_link: str | None = Field(None, max_length=500)
    official_url: str | None = Field(None, max_length=1000)
    series: str | None = Field(None, max_length=300)
    version_name: str | None = Field(None, max_length=500)
    jan_code: str | None = Field(None, max_length=50)
    character_name: str | None = Field(None, max_length=300)
    franchise_name: str | None = Field(None, max_length=300)

    @field_validator("image_url")
    @classmethod
    def _check_image_url(cls, v):
        return _validate_http_url(v)

    @field_validator("official_url")
    @classmethod
    def _check_official_url(cls, v):
        return _validate_http_url(v)


class AdminFigureBatchUpdate(BaseModel):
    """Batch-set ONE whitelisted field across multiple figures (admin 公仔管理).

    Excluded fields (would either clobber per-figure identity or break uniqueness):
      - name / original_name: bulk-setting destroys per-figure identity
      - jan_code: UNIQUE constraint would error on duplicates
      - image_url: clobbers per-figure images
      - retail_price / retail_currency: needs typed value, batch API only takes str
      - source_id / hpoi_link: per-figure scrape references
      - character_name / franchise_name: complex find-or-create logic, handled
        separately (see future character-batch endpoint).
    The per-field `max_length` constraints from AdminFigureUpdate are re-applied
    at endpoint time via AdminFigureUpdate.model_validate, so the value cap here
    (500) is just an outer limit — actual field caps (e.g. scale=50) still apply."""
    ids: list[int] = Field(..., min_length=1, max_length=200)
    field: Literal[
        # original 7 (category/line style)
        "series", "manufacturer", "scale",
        "figure_type", "age_rating", "material", "gender",
        # added per editor feedback: content metadata that's safe to bulk-set
        "sculptor", "painter", "release_date", "reissue_dates",
        "dimensions", "version_name",
        # added per community suggestion: illustrator (原画) + official site URL
        "illustrator", "official_url",
    ]
    # Cap raised from 500 → 1000 to accommodate official_url; each individual
    # field's tighter max_length from AdminFigureUpdate still applies via
    # model_validate at endpoint time.
    value: str | None = Field(None, max_length=1000)


class AdminFigureBatchUpdateCharacter(BaseModel):
    """Batch-set the character of N figures, INDEPENDENT of franchise.
    For each figure, the character entity is find-or-created under that
    figure's existing franchise_id. Figures with no franchise_id are skipped
    (set their franchise first via the franchise batch endpoint)."""
    ids: list[int] = Field(..., min_length=1, max_length=200)
    character_name: str = Field(..., min_length=1, max_length=300)


class AdminFigureBatchUpdateFranchise(BaseModel):
    """Batch-set the franchise of N figures, INDEPENDENT of character.
    Find-or-creates the named franchise and writes Figure.franchise_id (the
    denormalised column, not via character relationship)."""
    ids: list[int] = Field(..., min_length=1, max_length=200)
    franchise_name: str = Field(..., min_length=1, max_length=300)


class AdminListingUpdate(BaseModel):
    figure_id: int | None = Field(None, ge=1)
    title: str | None = Field(None, max_length=500)
    source: str | None = Field(None, max_length=100)
    source_id: str | None = Field(None, max_length=200)
    price: int | None = Field(None, ge=0, le=1_000_000_000)
    currency: Currency | None = None
    price_canonical: float | None = Field(None, ge=0)
    condition: Condition | None = None
    is_sold: bool | None = None
    url: str | None = Field(None, max_length=1000)
    image_url: str | None = Field(None, max_length=1000)
    sold_at: str | None = Field(None, max_length=50)
    notes: str | None = Field(None, max_length=2000)


class AdminListingCreate(BaseModel):
    figure_id: int = Field(..., ge=1)
    title: str | None = Field(None, max_length=500)
    source: str | None = Field(None, max_length=100)
    source_id: str | None = Field(None, max_length=200)
    price: int = Field(..., ge=0, le=1_000_000_000)
    currency: Currency = "TWD"
    price_canonical: float | None = Field(None, ge=0)
    condition: Condition | None = None
    is_sold: bool = True
    url: str | None = Field(None, max_length=1000)
    image_url: str | None = Field(None, max_length=1000)
    sold_at: str | None = Field(None, max_length=50)
    notes: str | None = Field(None, max_length=2000)


class AdminSubmissionUpdate(BaseModel):
    name: str | None = Field(None, max_length=500, min_length=1)
    original_name: str | None = Field(None, max_length=500)
    character_name: str | None = Field(None, max_length=300)
    franchise_name: str | None = Field(None, max_length=300)
    manufacturer: str | None = Field(None, max_length=300)
    scale: str | None = Field(None, max_length=50)
    retail_price: int | None = Field(None, ge=0, le=10_000_000)
    retail_currency: Currency | None = None
    series: str | None = Field(None, max_length=300)
    jan_code: str | None = Field(None, max_length=50)
    image_url: str | None = Field(None, max_length=1000)
    figure_type: str | None = Field(None, max_length=50)
    age_rating: str | None = Field(None, max_length=50)
    material: str | None = Field(None, max_length=100)
    sculptor: str | None = Field(None, max_length=500)
    painter: str | None = Field(None, max_length=500)
    illustrator: str | None = Field(None, max_length=500)
    dimensions: str | None = Field(None, max_length=200)
    gender: str | None = Field(None, max_length=20)
    release_date: str | None = Field(None, max_length=50)
    notes: str | None = Field(None, max_length=2000)
    official_url: str | None = Field(None, max_length=1000)

    @field_validator("image_url")
    @classmethod
    def _check_image_url(cls, v):
        return _validate_http_url(v)

    @field_validator("official_url")
    @classmethod
    def _check_official_url(cls, v):
        return _validate_http_url(v)


class UpdateMeIn(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=50)

    @field_validator("display_name")
    @classmethod
    def _clean(cls, v):
        if v is None:
            return None
        # Strip control chars and normalise whitespace
        cleaned = "".join(ch for ch in v if ch.isprintable()).strip()
        if not cleaned:
            raise ValueError("display_name cannot be empty after cleaning")
        return cleaned
