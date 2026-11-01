"""Every `{discriminator, oneOf}` node of an IR schema file rewritten as `allOf` of one `if`/`then` per variant, so
a plain 2020-12 validator reads the open unions as Ajv does: a known tag validates against its variant alone, an
unknown tag against none, as the open form accepts it."""

from typing import Final, cast

_DEFINITION_PREFIX: Final = "#/$defs/"

type JsonObject = dict[str, object]


def rewrite_discriminators(file_name: str, schema: JsonObject) -> JsonObject:
    definitions = schema.get("$defs")
    rewritten = _node(file_name, schema, definitions if isinstance(definitions, dict) else {})

    if not isinstance(rewritten, dict):
        raise ValueError(f"seampact-ir: the IR schema {file_name} is not an object.")

    return cast(JsonObject, rewritten)


def _node(file_name: str, node: object, definitions: JsonObject) -> object:
    if isinstance(node, list):
        return [_node(file_name, item, definitions) for item in node]

    if not isinstance(node, dict):
        return node

    members = {name: _node(file_name, value, definitions) for name, value in node.items()}

    if "discriminator" in members and "oneOf" in members:
        return _as_conditions(file_name, members, definitions)

    return members


def _as_conditions(file_name: str, union: JsonObject, definitions: JsonObject) -> JsonObject:
    discriminator = union["discriminator"]
    tag_member = discriminator.get("propertyName") if isinstance(discriminator, dict) else None
    variants = union["oneOf"]

    if not isinstance(tag_member, str) or not isinstance(variants, list):
        raise ValueError(f"seampact-ir: the IR schema {file_name} has a discriminator the union rewrite does not read.")

    conditions = [
        {
            "if": {
                "properties": {tag_member: {"const": _tag_of(file_name, variant, tag_member, definitions)}},
                "required": [tag_member],
            },
            "then": variant,
        }
        for variant in variants
    ]
    rewritten = {name: value for name, value in union.items() if name not in ("discriminator", "oneOf")}
    rewritten["allOf"] = conditions

    return rewritten


def _tag_of(file_name: str, variant: object, tag_member: str, definitions: JsonObject) -> object:
    reference = variant.get("$ref") if isinstance(variant, dict) else None
    name = (
        reference.removeprefix(_DEFINITION_PREFIX)
        if isinstance(reference, str) and reference.startswith(_DEFINITION_PREFIX)
        else None
    )
    definition = definitions.get(name) if name is not None else None
    properties = definition.get("properties") if isinstance(definition, dict) else None
    tag = properties.get(tag_member) if isinstance(properties, dict) else None

    if not isinstance(tag, dict) or "const" not in tag:
        shown = reference if isinstance(reference, str) else "a variant"

        raise ValueError(
            f"seampact-ir: the IR schema {file_name} variant {shown} has no const '{tag_member}'; "
            "the union rewrite does not know it."
        )

    return tag["const"]
