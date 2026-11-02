"""The refusal of a run-time step this release of the Django layer does not deliver yet: the generated declarations
import and type-check, and serving them stops with this error, named, rather than answering without the contract."""

from typing import Final

from django.core.exceptions import ImproperlyConfigured

PLACEMENT_UNAVAILABLE: Final = "django.placement.unavailable"


class PlacementUnavailableError(ImproperlyConfigured):
    """Raised by a run-time step a later release brings; the message names the step and the fix."""

    code = PLACEMENT_UNAVAILABLE

    def __init__(self, step: str) -> None:
        super().__init__(
            f"seampact {PLACEMENT_UNAVAILABLE}: {step} is not served by this release of the seampact Django layer. "
            "Install a release of seampact-django and of the target that serves it, then run seampact generate again."
        )
        self.step = step
