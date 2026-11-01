"""Untrusted text in a bundle message, as the compiler's `quote` prints it."""

import re
from collections.abc import Sequence
from typing import Final

from seampact.ir.read.refusal import escape_pointer_segment

_QUOTE_LIMIT: Final = 80
# C0, DEL and C1 controls, the bidi controls, and the line and paragraph separators.
_UNSAFE_CODE_POINTS: Final = re.compile(r"[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]")


def quoted(value: str) -> str:
    """`value` in single quotes, at most 80 code points, the unsafe code points as `\\uXXXX`."""
    kept = value[:_QUOTE_LIMIT]
    shown = _UNSAFE_CODE_POINTS.sub(lambda match: f"\\u{ord(match.group()):04X}", kept)

    return f"'{shown}{'…' if len(value) > _QUOTE_LIMIT else ''}'"


def pointer_below(pointer: str, member: str) -> str:
    return f"{pointer}/{escape_pointer_segment(member)}"


def listed_problems(problems: Sequence[str], limit: int) -> str:
    """At most `limit` problems joined, then how many more there are."""
    listed = "; ".join(problems[:limit])
    more = len(problems) - limit

    return f"{listed}; and {more} more" if more > 0 else listed
