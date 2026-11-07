"""The options and artefact switches of a ninja entry (ADR 0027 "Options and registration"): the Django targets'
shared set, `rules` for the shared Pydantic models, `views`, `sync` (the default) or `async`, and the `nativeDocs`
artefact switch."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.pydantic_models import RulesMode
from seampact.codegen.refusals import Refusals
from seampact.django.emitters import DjangoTargetOptions, OptionReader, django_target_options
from seampact.ir.config.json_value import JsonValue
from seampact.ninja.views_mode import ViewsMode

_RULES: Final = "rules"
_VIEWS: Final = "views"
_NATIVE_DOCS: Final = "nativeDocs"


@dataclass(frozen=True, slots=True)
class NinjaOptions:
    shared: DjangoTargetOptions
    rules: RulesMode
    views: ViewsMode
    native_docs: bool


def ninja_options(
    target: str, options: Mapping[str, JsonValue], artefacts: Mapping[str, JsonValue], refusals: Refusals
) -> NinjaOptions:
    own_options = (_RULES, _VIEWS)
    shared = django_target_options(target, own_options, options, artefacts, refusals, own_artefacts=(_NATIVE_DOCS,))
    reader = OptionReader(options, refusals)

    return NinjaOptions(
        shared,
        reader.choice(_RULES, RulesMode.NATIVE),
        reader.choice(_VIEWS, ViewsMode.SYNC),
        native_docs=artefacts.get(_NATIVE_DOCS) is True,
    )
