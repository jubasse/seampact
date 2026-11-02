"""The options and artefact switches of a ninja entry (ADR 0027 "Options and registration"): the Django targets'
shared set, `rules` for the shared Pydantic models, and `views`, `sync` (the default) or `async`. No `nativeDocs`
artefact is declared, so the shared reader refuses the key by name."""

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


@dataclass(frozen=True, slots=True)
class NinjaOptions:
    shared: DjangoTargetOptions
    rules: RulesMode
    views: ViewsMode


def ninja_options(
    target: str, options: Mapping[str, JsonValue], artefacts: Mapping[str, JsonValue], refusals: Refusals
) -> NinjaOptions:
    shared = django_target_options(target, (_RULES, _VIEWS), options, artefacts, refusals)
    reader = OptionReader(options, refusals)

    return NinjaOptions(shared, reader.choice(_RULES, RulesMode.NATIVE), reader.choice(_VIEWS, ViewsMode.SYNC))
