"""The emitters of the modules every Django target writes per api: the URLconf of the contract paths, the typed
settings the api reads from `settings.SEAMPACT`, and the boundary middleware's declaration. They need the
`generate` extra."""

from seampact.django.emitters.boundary_module import boundary_module
from seampact.django.emitters.settings_module import SettingsKey, settings_module
from seampact.django.emitters.urls_module import ContractPath, contract_paths, routes_named_by_path, urls_module

__all__ = [
    "ContractPath",
    "SettingsKey",
    "boundary_module",
    "contract_paths",
    "routes_named_by_path",
    "settings_module",
    "urls_module",
]
