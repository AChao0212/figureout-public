"""Shared figure serialization — single source of truth for all API responses."""


def serialize_figure_base(fig, char_name=None, fran_name=None):
    """Base serialization used by all endpoints. Never miss a field again."""
    return {
        "id": fig.id,
        "name": fig.name,
        "original_name": fig.original_name,
        "series": fig.series,
        "manufacturer": fig.manufacturer,
        "scale": fig.scale,
        "release_year": fig.release_year,
        "image_url": fig.image_url,
        "version_name": fig.version_name,
        "retail_price": fig.retail_price,
        "retail_currency": fig.retail_currency or "JPY",
        "sculptor": fig.sculptor,
        "painter": fig.painter,
        "illustrator": fig.illustrator,
        "dimensions": fig.dimensions,
        "material": fig.material,
        "gender": fig.gender,
        "figure_type": fig.figure_type,
        "age_rating": fig.age_rating,
        "release_date": fig.release_date,
        "reissue_dates": fig.reissue_dates,
        "official_url": fig.official_url,
        "character_name": char_name,
        "franchise_name": fran_name,
    }


def serialize_figure_card(fig, char_name=None, fran_name=None,
                          current_avg=None, current_median=None,
                          price_change_pct=None, price_trend_pct=None):
    """For search results, featured, browse — card-level data."""
    base = serialize_figure_base(fig, char_name, fran_name)
    base.update({
        "current_avg_price": float(current_avg) if current_avg is not None else None,
        "current_median_price": float(current_median) if current_median is not None else None,
        "price_change_pct": price_change_pct,
        "price_trend_pct": price_trend_pct,
    })
    return base


def serialize_figure_related(fig, median_p=None, pcp=None):
    """For related figures — minimal data."""
    return {
        "id": fig.id,
        "name": fig.name,
        "image_url": fig.image_url,
        "manufacturer": fig.manufacturer,
        "retail_price": fig.retail_price,
        "retail_currency": fig.retail_currency or "JPY",
        "current_median_price": float(median_p) if median_p is not None else None,
        "price_change_pct": pcp,
    }


def serialize_figure_admin(fig, char_name=None, fran_name=None):
    """For admin panel — all fields including internal ones."""
    base = serialize_figure_base(fig, char_name, fran_name)
    base.update({
        "source_id": fig.source_id,
        "jan_code": fig.jan_code,
        "character_id": fig.character_id,
        "view_count": fig.view_count,
    })
    return base
