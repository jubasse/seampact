"""The emitters of the modules every Django target writes per api: the URLconf of the contract paths, the typed settings
the api reads from `settings.SEAMPACT`, the boundary middleware's declaration, and the options every Django target
reads. They need the `generate` extra."""

from seampact.django.emitters.boundary_module import BoundaryBase, boundary_module
from seampact.django.emitters.settings_module import SettingsKey, settings_module
from seampact.django.emitters.target_options import DjangoTargetOptions, OptionReader, django_target_options
from seampact.django.emitters.urls_module import ContractPath, contract_paths, routes_named_by_path, urls_module

__all__ = [
    "BoundaryBase",
    "ContractPath",
    "DjangoTargetOptions",
    "OptionReader",
    "SettingsKey",
    "boundary_module",
    "contract_paths",
    "django_target_options",
    "routes_named_by_path",
    "settings_module",
    "urls_module",
]
