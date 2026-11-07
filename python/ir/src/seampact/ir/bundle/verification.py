"""The outcome of the pinned-bundle check."""

from collections.abc import Mapping
from dataclasses import dataclass, field

from seampact.ir.bundle.failure import BundleFailure
from seampact.ir.bundle.manifest import BundleManifest
from seampact.ir.model import ContractIR


@dataclass(frozen=True, slots=True)
class BundleVerification:
    """The manifest, the integrity, each api's IR and the IR bytes the check read, by api name, or the failures. A
    reader uses those bytes, never the file again, so what it reads is what passed. `integrity` is the recomputed
    value once step 1 passed, the value to pin, even when a later step fails."""

    manifest: BundleManifest | None = None
    integrity: str | None = None
    irs: Mapping[str, ContractIR] = field(default_factory=dict)
    ir_bytes: Mapping[str, bytes] = field(default_factory=dict)
    failures: tuple[BundleFailure, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.failures


def refused(failures: list[BundleFailure], integrity: str | None = None) -> BundleVerification:
    return BundleVerification(integrity=integrity, failures=tuple(failures))
