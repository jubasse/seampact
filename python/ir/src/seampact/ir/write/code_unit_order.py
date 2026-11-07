"""Code-unit order of two strings, as JavaScript compares strings (ADR 0015 "Generate is pure"), never a locale's:
the order of their UTF-16 code units. Python compares code points, which differs only between a character past
U+FFFF (two surrogates, D800 to DFFF) and one from U+E000 to U+FFFF."""

from functools import cmp_to_key


def code_unit_key(text: str) -> list[int]:
    """The UTF-16 code units of `text`, to sort by."""
    data = text.encode("utf-16-be", errors="surrogatepass")

    return [int.from_bytes(data[position : position + 2], "big") for position in range(0, len(data), 2)]


def compare_code_units(left: str, right: str) -> int:
    left_units = code_unit_key(left)
    right_units = code_unit_key(right)

    return (left_units > right_units) - (left_units < right_units)


code_unit_sort_key = cmp_to_key(compare_code_units)
