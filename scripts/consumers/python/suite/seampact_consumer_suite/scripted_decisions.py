"""What the loaded script tells the decide doubles, framework-free: the denial code of a right or rule, by name and,
when the script names one, by purpose (`route`, `field` or `sortKey`)."""

from seampact.hooks import Purpose, purpose
from seampact_consumer_suite.control_state import loaded_script

_PURPOSE_NAMES = ((purpose.Route, "route"), (purpose.Field, "field"), (purpose.SortKey, "sortKey"))


def purpose_name(asked_for: Purpose) -> str:
    for kind, name in _PURPOSE_NAMES:
        if isinstance(asked_for, kind):
            return name

    raise ValueError(f"the decide request has the unknown purpose {type(asked_for).__qualname__}")


def scripted_decision(name: str, asked_for: Purpose) -> str | None:
    """The code the script denies `name` with for this purpose, None when it allows it."""
    decisions = loaded_script().get("decisions")

    for decision in decisions if isinstance(decisions, list) else []:
        if not isinstance(decision, dict) or decision.get("name") != name:
            continue

        scripted_purpose = decision.get("purpose")

        if scripted_purpose is not None and scripted_purpose != purpose_name(asked_for):
            continue

        deny = decision.get("deny")
        code = deny.get("code") if isinstance(deny, dict) else None

        if not isinstance(code, str):
            raise ValueError(f"the loaded script denies '{name}' without a code")

        return code

    return None
