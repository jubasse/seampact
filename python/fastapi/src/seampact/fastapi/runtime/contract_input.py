"""Steps 6 to 8 of one operation (ADR 0026 "Types and validation"): its path, query and header parts and its body,
decoded by the boundary, validated by the generated models in Pydantic's strict mode; every issue of every part is
reported together as the operation's `schemaInvalid` refusal. Then the typed request: the input, the principal the
access steps admitted and the scopes they resolved, one attribute per scope in declared order."""

import dataclasses
import typing
from collections.abc import Mapping
from typing import Final, TypeGuard

import pydantic

from seampact.codegen.runtime.access_steps import AccessState
from seampact.codegen.runtime.contract import HEADER_PART, PATH_PART, PROOFS_PART, QUERY_PART, ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.input_decoding import DecodedInput, Issue, schema_invalid
from seampact.codegen.runtime.ir_view import ir_map, ir_maps, ir_string
from seampact.codegen.runtime.pydantic.issues import MAX_RENDERED_ISSUES, body_issues, part_issues, proof_issues
from seampact.codegen.runtime.wire_codec import WireCodec
from seampact.codegen.runtime.wire_values import raw_query
from seampact.fastapi.runtime.handler_reply import OperationTypes

_INPUT_FIELD: Final = "input"
_PRINCIPAL_FIELD: Final = "principal"
_SCOPES_FIELD: Final = "scopes"
_BODY_FIELD: Final = "body"
_UNKNOWN_KEYS_RULE: Final = "unknownKeys"
_REFUSE: Final = "refuse"
_IGNORE: Final = "ignore"
# The input attribute of each part and where its issues are reported.
_PARTS: Final = (("path", PATH_PART), ("query", QUERY_PART), ("headers", HEADER_PART))


class InputBuilder:
    """Built once per operation, when its route is added; reads the generated types' annotations."""

    def __init__(self, contract: ApiContract, operation_id: str, types: OperationTypes) -> None:
        self._contract = contract
        self._operation_id = operation_id
        self._request_type = types.request
        request_fields = typing.get_type_hints(types.request)
        self._input_type = request_fields.get(_INPUT_FIELD)
        self._scopes_type = request_fields.get(_SCOPES_FIELD)
        self._has_principal = _PRINCIPAL_FIELD in request_fields
        input_fields = {} if self._input_type is None else typing.get_type_hints(self._input_type)
        self._part_models = {
            attribute: model
            for attribute, _ in _PARTS
            if isinstance(model := input_fields.get(attribute), type) and issubclass(model, pydantic.BaseModel)
        }
        body_type = input_fields.get(_BODY_FIELD)
        self._body = None if body_type is None else pydantic.TypeAdapter[object](body_type)
        self._proofs_model = types.proofs if _is_model(types.proofs) else None
        self._proof_types = {
            ir_string(proof, "name") or "": ir_map(proof, "schema")
            for proof in ir_maps(ir_map(contract.operation(operation_id), "input"), "proofs")
        }

    def build(self, decoded: DecodedInput, access: AccessState, raw_query_string: str) -> object:
        """Raises the operation's `schemaInvalid` refusal with every issue at once."""
        issues: list[Issue] = []
        values: dict[str, object] = {}
        wire_parts = {"path": decoded.path, "query": decoded.query, "headers": decoded.headers}

        for attribute, part in _PARTS:
            model = self._part_models.get(attribute)
            members = self._contract.part_members(self._operation_id, part)

            if part == QUERY_PART:
                issues += self._unknown_query(members, raw_query_string)

            if model is None:
                continue

            renamed = {members[name]: value for name, value in wire_parts[attribute].items() if name in members}

            try:
                values[attribute] = model.model_validate(renamed, strict=True)
            except pydantic.ValidationError as error:
                issues += part_issues(part, members, error)

        if self._body is not None:
            issues += self._validate_body(decoded.body, values)

        if issues:
            raise schema_invalid(self._contract, self._operation_id, issues[:MAX_RENDERED_ISSUES])

        return self._typed_request(values, access)

    def _unknown_query(self, members: Mapping[str, str], raw_query_string: str) -> list[Issue]:
        if self._contract.ignores_unknown_query(self._operation_id):
            return []

        return [
            Issue(QUERY_PART, f"/{name}", _UNKNOWN_KEYS_RULE)
            for name in raw_query(raw_query_string)
            if name not in members
        ]

    def _validate_body(self, tree: object, values: dict[str, object]) -> list[Issue]:
        if self._body is None:
            return []

        type_use = ir_map(ir_map(self._contract.operation(self._operation_id), "input"), "schema")
        policy = self._contract.unknown_keys_policy(self._operation_id)

        if policy not in (_REFUSE, _IGNORE):
            raise BoundaryFailureError(
                f"seampact: operation '{self._operation_id}' keeps unknown body keys, which this seampact-fastapi "
                "release does not serve; leave the operation out with the entry's `operations` filter."
            )

        issues = self._proof_issues(tree)
        python_tree = WireCodec(self._contract).to_python(type_use, self._without_proofs(tree))

        if policy == _REFUSE:
            issues += [Issue(_BODY_FIELD, pointer, _UNKNOWN_KEYS_RULE) for pointer in python_tree.unknown_keys]

        try:
            values[_BODY_FIELD] = self._body.validate_python(python_tree.value, strict=True)
        except pydantic.ValidationError as error:
            issues += body_issues(self._contract, type_use, error)

        return issues

    def _proof_issues(self, tree: object) -> list[Issue]:
        """Each rule proof checked by its full type (enum, pattern, bounds, nested members), as the body's other
        members are; the access steps only checked its scalar type before the decider read it."""
        if self._proofs_model is None or not isinstance(tree, dict):
            return []

        members = self._contract.part_members(self._operation_id, PROOFS_PART)
        codec = WireCodec(self._contract)
        renamed = {
            members[name]: codec.to_python(type_use, tree[name]).value
            for name, type_use in self._proof_types.items()
            if name in tree and name in members
        }

        try:
            self._proofs_model.model_validate(renamed, strict=True)
        except pydantic.ValidationError as error:
            return proof_issues(self._contract, self._proof_types, members, error)

        return []

    def _without_proofs(self, tree: object) -> object:
        """The body without the rule proofs, which the access steps read and the handler never sees."""
        if not isinstance(tree, dict) or not self._proof_types:
            return tree

        return {name: value for name, value in tree.items() if name not in self._proof_types}

    def _typed_request(self, values: dict[str, object], access: AccessState) -> object:
        if self._input_type is None:
            raise BoundaryFailureError(
                f"seampact: the request type of operation '{self._operation_id}' has no input; regenerate the api."
            )

        arguments: dict[str, object] = {_INPUT_FIELD: self._input_type(**values)}

        if self._has_principal:
            arguments[_PRINCIPAL_FIELD] = access.principal

        if self._scopes_type is not None:
            names = [field.name for field in dataclasses.fields(self._scopes_type)]
            resolved = {scope.scope: scope for scope in access.scopes}
            scope_ids = [
                ir_string(entry, "scope") or ""
                for entry in ir_maps(self._contract.operation(self._operation_id), "scopes")
            ]
            arguments[_SCOPES_FIELD] = self._scopes_type(
                **{name: resolved[scope_id] for name, scope_id in zip(names, scope_ids, strict=True)}
            )

        return self._request_type(**arguments)


def _is_model(candidate: type | None) -> TypeGuard[type[pydantic.BaseModel]]:
    return isinstance(candidate, type) and issubclass(candidate, pydantic.BaseModel)
