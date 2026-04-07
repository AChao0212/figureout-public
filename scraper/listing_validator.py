"""Validate scraped listings — flag non-figure items for admin review."""

import re
import logging

logger = logging.getLogger(__name__)

# Keywords that indicate the listing is NOT a PVC figure
# Each entry is (keyword, must_not_follow_patterns)
# If the keyword is followed by 付き/付属/セット付 etc., it's a bonus item, not the main product
REJECT_KEYWORDS = [
    "ぬいぐるみ",
    "アクリルスタンド",
    "アクリルキーホルダー",
    "キーホルダー",
    "ストラップ",
    "缶バッジ",
    "タペストリー",
    "抱き枕",
    "ラバスト",
    "ラバーストラップ",
    "クリアファイル",
    "ポスター",
    "Tシャツ",
    "マグカップ",
    "トレーディング",
    "ガチャ",
    "ちょこのせ",
    "ワーコレ",
]

# If keyword is followed by these patterns, it's a bonus/bundled item → NOT a reject
BONUS_PATTERNS = re.compile(r"付き|付属|セット付|おまけ|特典")

# Keywords that indicate a mixed lot
LOT_KEYWORDS = ["まとめ", "まとめて", "まとめ売り"]


def validate_listing(title: str, expected_character: str = "") -> tuple[bool, str]:
    """
    Validate if a listing title is likely a PVC figure.

    Returns:
        (is_valid, reason) - if not valid, reason explains why
    """
    if not title:
        return True, ""

    # Check reject keywords
    for kw in REJECT_KEYWORDS:
        idx = title.find(kw)
        if idx == -1:
            continue
        # Check if this keyword is followed by a bonus pattern (e.g. タペストリー付き)
        after = title[idx + len(kw):idx + len(kw) + 10]
        if BONUS_PATTERNS.search(after):
            continue  # It's a bonus item bundled with a figure, not the main product
        # Check if preceded by 特典/限定 + keyword (e.g. 特典タペストリー付き)
        before = title[max(0, idx - 5):idx]
        if "特典" in before or "限定" in before:
            # Still need to check if 付き follows
            if BONUS_PATTERNS.search(after):
                continue
        return False, f"non-figure item: {kw}"

    # Check lot keywords
    for kw in LOT_KEYWORDS:
        if kw in title:
            if re.search(r'\d+\s*[点個]', title):
                return False, f"bulk/lot: {kw}"
            return False, f"bulk/lot: {kw}"

    return True, ""
