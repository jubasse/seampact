"""The boundary middleware a DRF api's generated `<Api>Boundary` extends: the Django boundary, whose boot check also
reads the `access` setting DRF adds (ADR 0027 "DRF")."""

from collections.abc import Mapping

from seampact.django.runtime import ContractBoundary
from seampact.drf.runtime.access_classes import access_problems


class DrfContractBoundary(ContractBoundary):
    @classmethod
    def target_settings_problems(cls, own: Mapping[str, object]) -> list[str]:
        return access_problems(cls.contract, own)
