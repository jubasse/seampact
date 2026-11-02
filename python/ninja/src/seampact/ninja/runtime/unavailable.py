"""The refusal of the placement pieces this release of `seampact-ninja` does not run yet: the Router, the views'
steps and the boot check come with the next release, so binding an api refuses by name before it changes the app."""

from typing import Final

PLACEMENT_UNAVAILABLE: Final = "ninja.placement.unavailable"


class PlacementUnavailableError(RuntimeError):
    code = PLACEMENT_UNAVAILABLE

    def __init__(self, api: str, piece: str) -> None:
        super().__init__(
            f"seampact {PLACEMENT_UNAVAILABLE}: the '{api}' api cannot be served yet: {piece} comes with a later "
            "seampact-ninja release. Update seampact-ninja and generate again; until then, do not call bind on a "
            "served app."
        )
        self.api = api
        self.piece = piece
