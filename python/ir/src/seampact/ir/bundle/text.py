"""Pointers and problem lists in a bundle message; untrusted text is quoted by `seampact.ir.https.untrusted_text`."""

from collections.abc import Sequence

from seampact.ir.read.refusal import escape_pointer_segment


def pointer_below(pointer: str, member: str) -> str:
    return f"{pointer}/{escape_pointer_segment(member)}"


def listed_problems(problems: Sequence[str], limit: int) -> str:
    """At most `limit` problems joined, then how many more there are."""
    listed = "; ".join(problems[:limit])
    more = len(problems) - limit

    return f"{listed}; and {more} more" if more > 0 else listed
