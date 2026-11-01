# Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
# Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

"""The shape of every IR definition the must-act walk enters, by schema name."""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from seampact.ir.shape import ItemsShape, NamedShape, OpenEnumShape, Shape, StructShape, UnionShape, ValuesShape

_SHAPES: Final[dict[str, Shape]] = {
    "Absent": OpenEnumShape(("omit", "null"), False),
    "Access": UnionShape(
        "kind",
        True,
        MappingProxyType({"identity": "IdentityAccess", "optional": "OptionalAccess", "public": "PublicAccess"}),
    ),
    "Api": StructShape(
        MappingProxyType(
            {
                "name": NamedShape("Name"),
                "version": NamedShape("ApiVersion"),
                "kind": NamedShape("ApiKind"),
                "pathVersion": NamedShape("PathVersion"),
                "role": NamedShape("ApiRole"),
                "maturity": NamedShape("Maturity"),
                "caller": NamedShape("ApiCaller"),
                "compat": NamedShape("Compat"),
                "wire": NamedShape("ApiWire"),
                "surfaces": ValuesShape(NamedShape("Surface")),
                "documents": ValuesShape(NamedShape("ApiDocument")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "ApiCaller": StructShape(MappingProxyType({"identity": NamedShape("IdentityId"), "right": NamedShape("RightId")})),
    "ApiDocument": StructShape(
        MappingProxyType({"surfaces": ItemsShape(NamedShape("SurfaceId")), "internal": NamedShape("InternalPolicy")}),
    ),
    "ApiKind": OpenEnumShape(("product", "service"), False),
    "ApiRole": OpenEnumShape(("gateway",), False),
    "ApiVersion": UnionShape("kind", False, MappingProxyType({"path": "PathApiVersion", "label": "LabelApiVersion"})),
    "ApiWire": StructShape(
        MappingProxyType(
            {
                "int64": NamedShape("Int64Wire"),
                "outputEnums": NamedShape("OutputEnumForm"),
                "urls": NamedShape("UrlForm"),
            },
        ),
    ),
    "ApplicationSignature": StructShape(MappingProxyType({"key": NamedShape("SchemeKey")})),
    "ArrayTemplate": StructShape(MappingProxyType({"items": ItemsShape(NamedShape("Template"))})),
    "ArrayTypeUse": StructShape(MappingProxyType({"items": NamedShape("TypeUse"), "docs": NamedShape("Docs")})),
    "BasicScheme": StructShape(MappingProxyType({"id": NamedShape("SchemeId"), "origin": NamedShape("Origin")})),
    "BearerFacts": StructShape(MappingProxyType({"oauth2": NamedShape("OAuth2")})),
    "BearerScheme": StructShape(
        MappingProxyType(
            {"id": NamedShape("SchemeId"), "bearer": NamedShape("BearerFacts"), "origin": NamedShape("Origin")},
        ),
    ),
    "Binding": StructShape(
        MappingProxyType(
            {"from": NamedShape("ValueSource"), "to": NamedShape("ValueSource"), "origin": NamedShape("Origin")},
        ),
    ),
    "BodyUnionTag": StructShape(MappingProxyType({})),
    "Bucket": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("BucketId"),
                "key": ItemsShape(NamedShape("ValueSource")),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "Cache": StructShape(
        MappingProxyType(
            {
                "directives": NamedShape("CacheDirectives"),
                "anonymous": NamedShape("CacheVisibility"),
                "perCallerKind": ItemsShape(NamedShape("CallerCacheControl")),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "CacheDirectives": StructShape(MappingProxyType({})),
    "CacheVisibility": OpenEnumShape(("public", "private"), False),
    "CallerCacheControl": StructShape(MappingProxyType({"caller": NamedShape("CallerKind")})),
    "CallerKind": OpenEnumShape(("anonymous", "identified"), False),
    "CatalogueEnumSource": StructShape(MappingProxyType({"enum": NamedShape("EnumId")})),
    "Compat": StructShape(MappingProxyType({"policy": NamedShape("CompatPolicy")})),
    "CompatPolicy": OpenEnumShape(("additive-only", "none"), False),
    "Concurrency": StructShape(
        MappingProxyType({"version": NamedShape("ValueSource"), "derivedFrom": NamedShape("DerivedFrom")}),
    ),
    "ContractIR": StructShape(
        MappingProxyType(
            {
                "kinds": ItemsShape(NamedShape("DeclarationKind")),
                "features": ItemsShape(NamedShape("Feature")),
                "api": NamedShape("Api"),
                "packs": ItemsShape(NamedShape("PackRef")),
                "conventions": NamedShape("Conventions"),
                "formats": ValuesShape(NamedShape("WireFormat")),
                "pagings": ValuesShape(NamedShape("PagingStyle")),
                "schemas": ValuesShape(NamedShape("Schema")),
                "scalars": ValuesShape(NamedShape("Scalar")),
                "enums": ValuesShape(NamedShape("Enum")),
                "errors": ValuesShape(NamedShape("ErrorDecl")),
                "natures": ValuesShape(NamedShape("NatureDecl")),
                "schemes": ValuesShape(NamedShape("Scheme")),
                "headers": ValuesShape(NamedShape("HeaderDecl")),
                "identities": ValuesShape(NamedShape("Identity")),
                "rights": ValuesShape(NamedShape("Right")),
                "rules": ValuesShape(NamedShape("Rule")),
                "scopes": ValuesShape(NamedShape("Scope")),
                "buckets": ValuesShape(NamedShape("Bucket")),
                "services": ValuesShape(NamedShape("Service")),
                "extensionKeys": ValuesShape(NamedShape("ExtensionKeyDecl")),
                "lint": NamedShape("Lint"),
                "operations": ItemsShape(NamedShape("Operation")),
            },
        ),
    ),
    "ConventionValue": StructShape(MappingProxyType({"origin": NamedShape("Origin")})),
    "Conventions": ValuesShape(NamedShape("ConventionValue")),
    "CookieScheme": StructShape(
        MappingProxyType(
            {"id": NamedShape("SchemeId"), "csrf": NamedShape("SchemeId"), "origin": NamedShape("Origin")},
        ),
    ),
    "CredentialIdentity": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("IdentityId"),
                "schemes": NamedShape("CredentialSchemes"),
                "principal": NamedShape("Principal"),
                "errors": ItemsShape(NamedShape("ErrorCode")),
                "headers": ItemsShape(NamedShape("IdentityHeaderUse")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "CredentialSchemes": StructShape(
        MappingProxyType(
            {
                "read": ItemsShape(NamedShape("SchemeId")),
                "write": ItemsShape(NamedShape("SchemeId")),
                "optionalRead": ItemsShape(NamedShape("SchemeId")),
            },
        ),
    ),
    "Csrf": UnionShape("kind", True, MappingProxyType({"derived": "DerivedCsrf", "exempt": "ExemptCsrf"})),
    "DeclarationKind": OpenEnumShape(("httpOperation",), False),
    "Degradable": StructShape(MappingProxyType({"origin": NamedShape("Origin")})),
    "Deprecation": StructShape(
        MappingProxyType({"successor": NamedShape("OperationRef"), "origin": NamedShape("Origin")}),
    ),
    "DerivedCsrf": StructShape(MappingProxyType({"derivedFrom": NamedShape("DerivedFrom")})),
    "DerivedFrom": StructShape(
        MappingProxyType({"derivation": NamedShape("DerivationId"), "from": ItemsShape(NamedShape("Origin"))}),
    ),
    "DerivedIdempotency": StructShape(
        MappingProxyType({"enforce": NamedShape("IdempotencyEnforcement"), "derivedFrom": NamedShape("DerivedFrom")}),
    ),
    "Direction": OpenEnumShape(("input", "output"), False),
    "Docs": StructShape(MappingProxyType({})),
    "EachTemplate": StructShape(MappingProxyType({"of": NamedShape("Slot"), "as": NamedShape("Template")})),
    "Enum": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("EnumId"),
                "name": NamedShape("Name"),
                "codeNames": ValuesShape(NamedShape("Name")),
                "source": NamedShape("EnumSource"),
                "localReason": NamedShape("Reason"),
                "directions": ItemsShape(NamedShape("Direction")),
                "docs": NamedShape("Docs"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "EnumNarrowing": StructShape(MappingProxyType({"reason": NamedShape("Reason")})),
    "EnumSource": UnionShape(
        "kind",
        False,
        MappingProxyType({"vocabulary": "VocabularyEnumSource", "enum": "CatalogueEnumSource"}),
    ),
    "EnumTypeUse": StructShape(
        MappingProxyType(
            {"enum": NamedShape("EnumId"), "narrowedTo": NamedShape("EnumNarrowing"), "docs": NamedShape("Docs")},
        ),
    ),
    "ErrorDecl": StructShape(
        MappingProxyType(
            {
                "code": NamedShape("ErrorCode"),
                "nature": NamedShape("NatureBase"),
                "natureName": NamedShape("NatureId"),
                "http": NamedShape("ErrorHttp"),
                "params": NamedShape("SchemaRef"),
                "docs": NamedShape("Docs"),
                "origin": NamedShape("Origin"),
                "default": NamedShape("ErrorRole"),
            },
        ),
    ),
    "ErrorHttp": StructShape(MappingProxyType({})),
    "ErrorRole": OpenEnumShape(
        (
            "schemaInvalid",
            "payloadTooLarge",
            "unsupportedMediaType",
            "unauthenticated",
            "csrfInvalid",
            "idempotencyKeyReused",
            "idempotencyInProgress",
            "stateConflict",
            "preconditionFailed",
            "preconditionRequired",
            "notFound",
            "forbidden",
            "sortKeyForbidden",
            "rateLimited",
            "deadlineExceeded",
            "gone",
            "upstreamUnavailable",
            "serviceUnavailable",
            "upstreamTimeout",
            "undeclaredStatus",
        ),
        False,
    ),
    "ErrorRoleBinding": StructShape(
        MappingProxyType({"role": NamedShape("ErrorRole"), "params": NamedShape("Template")}),
    ),
    "ErrorShape": StructShape(
        MappingProxyType({"body": NamedShape("Template"), "headers": ItemsShape(NamedShape("HeaderTemplate"))}),
    ),
    "ExemptCsrf": StructShape(MappingProxyType({"reason": NamedShape("Reason"), "origin": NamedShape("Origin")})),
    "ExemptIdempotency": StructShape(
        MappingProxyType({"reason": NamedShape("Reason"), "origin": NamedShape("Origin")}),
    ),
    "ExtensionKeyDecl": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("ExtensionKeyId"),
                "prefix": NamedShape("ExtensionPrefix"),
                "key": NamedShape("ExtensionKey"),
                "schema": NamedShape("TypeUse"),
                "places": ItemsShape(NamedShape("ExtensionPlace")),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "ExtensionPlace": OpenEnumShape(("api", "operation", "schema", "property", "right", "rule", "scope"), False),
    "FieldRestriction": StructShape(
        MappingProxyType(
            {"right": NamedShape("RightId"), "inputPolicy": NamedShape("InputPolicy"), "origin": NamedShape("Origin")},
        ),
    ),
    "FieldRight": StructShape(
        MappingProxyType(
            {
                "schema": NamedShape("SchemaId"),
                "right": NamedShape("RightId"),
                "subject": NamedShape("FieldRightSubject"),
                "direction": NamedShape("Direction"),
                "inputPolicy": NamedShape("InputPolicy"),
                "always": NamedShape("FieldRightAlways"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "FieldRightAlways": OpenEnumShape(("absent",), True),
    "FieldRightSubject": StructShape(MappingProxyType({"source": NamedShape("ValueSource")})),
    "FieldWire": StructShape(
        MappingProxyType({"kind": NamedShape("FieldWireKind"), "style": NamedShape("QueryStyle")}),
    ),
    "FieldWireKind": OpenEnumShape(("number", "boolean", "list", "text", "object", "file", "json"), False),
    "FileTypeUse": StructShape(MappingProxyType({"docs": NamedShape("Docs")})),
    "HandlerResultMember": OpenEnumShape(
        ("nextCursor", "previousCursor", "total", "more", "nextSince", "complete"),
        False,
    ),
    "HeaderDecl": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("HeaderId"),
                "semantic": NamedShape("HeaderSemantic"),
                "in": NamedShape("HeaderSide"),
                "schema": NamedShape("TypeUse"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "HeaderScheme": StructShape(MappingProxyType({"id": NamedShape("SchemeId"), "origin": NamedShape("Origin")})),
    "HeaderSemantic": OpenEnumShape(("deadline", "traceContext", "actorSurface", "versionToken"), False),
    "HeaderSide": OpenEnumShape(("request", "response"), False),
    "HeaderTemplate": StructShape(MappingProxyType({"value": NamedShape("Template")})),
    "HeaderUnionTag": StructShape(MappingProxyType({})),
    "HeaderUseFor": OpenEnumShape(("all", "reads", "writes"), False),
    "HttpMethod": OpenEnumShape(("get", "post", "put", "patch", "delete"), False),
    "Idempotency": UnionShape(
        "kind",
        True,
        MappingProxyType({"derived": "DerivedIdempotency", "exempt": "ExemptIdempotency"}),
    ),
    "IdempotencyEnforcement": OpenEnumShape(("boundary", "none"), False),
    "Identity": UnionShape(
        "kind",
        True,
        MappingProxyType({"credential": "CredentialIdentity", "signed": "SignedIdentity"}),
    ),
    "IdentityAccess": StructShape(
        MappingProxyType(
            {
                "identity": NamedShape("IdentityId"),
                "schemes": ItemsShape(NamedShape("SchemeId")),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "IdentityHeaderUse": StructShape(
        MappingProxyType(
            {
                "header": NamedShape("HeaderId"),
                "for": NamedShape("HeaderUseFor"),
                "schema": NamedShape("TypeUse"),
                "from": NamedShape("ValueSource"),
                "stale": NamedShape("ErrorCode"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "IgnoreKeysPolicy": StructShape(MappingProxyType({"reason": NamedShape("Reason")})),
    "IgnoreUnknownQuery": StructShape(
        MappingProxyType({"reason": NamedShape("Reason"), "origin": NamedShape("Origin")}),
    ),
    "InputField": StructShape(MappingProxyType({"wire": NamedShape("FieldWire")})),
    "InputMediaType": OpenEnumShape(
        ("application/json", "application/x-www-form-urlencoded", "multipart/form-data"),
        False,
    ),
    "InputPolicy": OpenEnumShape(("reject", "strip"), True),
    "InputProof": StructShape(
        MappingProxyType(
            {
                "schema": NamedShape("TypeUse"),
                "wire": NamedShape("FieldWire"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "Int64Wire": OpenEnumShape(("string", "number"), False),
    "InternalPolicy": OpenEnumShape(("include", "exclude"), False),
    "JsonContent": StructShape(
        MappingProxyType({"media": NamedShape("JsonMediaType"), "schema": NamedShape("TypeUse")}),
    ),
    "JsonMediaType": OpenEnumShape(("application/json",), False),
    "KeepKeysPolicy": StructShape(MappingProxyType({"reason": NamedShape("Reason")})),
    "KeysPolicy": UnionShape(
        "policy",
        True,
        MappingProxyType({"ignore": "IgnoreKeysPolicy", "keep": "KeepKeysPolicy"}),
    ),
    "LabelApiVersion": StructShape(MappingProxyType({})),
    "Lint": StructShape(
        MappingProxyType({"rules": ValuesShape(NamedShape("LintRule")), "allows": ItemsShape(NamedShape("LintAllow"))}),
    ),
    "LintAllow": StructShape(MappingProxyType({"at": NamedShape("Origin"), "reason": NamedShape("Reason")})),
    "LintRule": StructShape(MappingProxyType({"severity": NamedShape("LintSeverity"), "origin": NamedShape("Origin")})),
    "LintSeverity": OpenEnumShape(("disabled", "warning", "error"), False),
    "LiteralTemplate": StructShape(MappingProxyType({})),
    "MapSchema": StructShape(
        MappingProxyType(
            {
                "keys": NamedShape("TypeUse"),
                "values": NamedShape("TypeUse"),
                "id": NamedShape("SchemaId"),
                "name": NamedShape("Name"),
                "directions": ItemsShape(NamedShape("Direction")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "Maturity": OpenEnumShape(("experimental", "provisional", "stable"), False),
    "MaturitySource": OpenEnumShape(("api", "upstream", "stated"), False),
    "MemberName": UnionShape("kind", False, MappingProxyType({"text": "PlainMemberName", "slot": "SlotMemberName"})),
    "MetaFill": OpenEnumShape(("now", "traceId", "degraded", "handler", "source"), False),
    "MetaMember": StructShape(
        MappingProxyType(
            {"type": NamedShape("TypeUse"), "fill": NamedShape("MetaFill"), "source": NamedShape("ValueSource")},
        ),
    ),
    "Name": StructShape(MappingProxyType({"role": NamedShape("NameRole")})),
    "NameRole": OpenEnumShape(
        (
            "schema",
            "input",
            "output",
            "query",
            "headers",
            "path",
            "response",
            "params",
            "error",
            "errors",
            "property",
            "item",
            "value",
            "variant",
            "endpoints",
            "operation",
            "member",
            "enumMember",
        ),
        False,
    ),
    "NamedTemplate": StructShape(MappingProxyType({"value": NamedShape("Template")})),
    "NatureBase": OpenEnumShape(("refused", "unavailable", "failed"), False),
    "NatureDecl": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("NatureId"),
                "base": NamedShape("NatureBase"),
                "docs": NamedShape("Docs"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "NoSubject": StructShape(MappingProxyType({})),
    "OAuth2": StructShape(MappingProxyType({})),
    "ObjectSchema": StructShape(
        MappingProxyType(
            {
                "properties": ItemsShape(NamedShape("Property")),
                "id": NamedShape("SchemaId"),
                "name": NamedShape("Name"),
                "directions": ItemsShape(NamedShape("Direction")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "ObjectTemplate": StructShape(
        MappingProxyType({"members": ItemsShape(NamedShape("ObjectTemplateMember")), "merge": NamedShape("Slot")}),
    ),
    "ObjectTemplateMember": StructShape(
        MappingProxyType({"name": NamedShape("MemberName"), "value": NamedShape("Template")}),
    ),
    "OpShorthand": OpenEnumShape(("list", "get", "create", "update", "delete", "batch"), False),
    "OpaqueTypeUse": StructShape(
        MappingProxyType({"reason": NamedShape("Reason"), "origin": NamedShape("Origin"), "docs": NamedShape("Docs")}),
    ),
    "Operation": StructShape(
        MappingProxyType(
            {
                "kind": NamedShape("DeclarationKind"),
                "id": NamedShape("OperationId"),
                "name": NamedShape("Name"),
                "surface": NamedShape("SurfaceId"),
                "op": NamedShape("OpShorthand"),
                "resource": NamedShape("OperationResource"),
                "features": ItemsShape(NamedShape("Feature")),
                "method": NamedShape("HttpMethod"),
                "params": NamedShape("Params"),
                "unknownQuery": NamedShape("UnknownQuery"),
                "access": NamedShape("Access"),
                "callerKinds": ItemsShape(NamedShape("CallerKind")),
                "principalRequires": ItemsShape(NamedShape("PrincipalRequirement")),
                "scopes": ItemsShape(NamedShape("OperationScope")),
                "requires": ItemsShape(NamedShape("Requirement")),
                "bindings": ItemsShape(NamedShape("Binding")),
                "input": NamedShape("OperationInput"),
                "responses": ItemsShape(NamedShape("Response")),
                "errors": ItemsShape(NamedShape("OperationError")),
                "fieldRights": ItemsShape(NamedShape("FieldRight")),
                "idempotency": NamedShape("Idempotency"),
                "concurrency": NamedShape("Concurrency"),
                "owner": NamedShape("Owner"),
                "cache": NamedShape("Cache"),
                "paging": NamedShape("Paging"),
                "filteredBy": NamedShape("RightId"),
                "degradable": NamedShape("Degradable"),
                "deprecated": NamedShape("Deprecation"),
                "relays": NamedShape("OperationRef"),
                "upstream": ItemsShape(NamedShape("ServiceId")),
                "maturity": NamedShape("OperationMaturity"),
                "csrf": NamedShape("Csrf"),
                "format": NamedShape("FormatId"),
                "examples": ValuesShape(NamedShape("OperationExample")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "OperationError": StructShape(
        MappingProxyType(
            {
                "code": NamedShape("ErrorCode"),
                "roles": ItemsShape(NamedShape("ErrorRoleBinding")),
                "retryHeader": NamedShape("RetryHeader"),
                "derivedFrom": NamedShape("DerivedFrom"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "OperationExample": StructShape(MappingProxyType({"error": NamedShape("ErrorCode")})),
    "OperationInput": StructShape(
        MappingProxyType(
            {
                "media": NamedShape("InputMediaType"),
                "schema": NamedShape("TypeUse"),
                "fields": ItemsShape(NamedShape("InputField")),
                "proofs": ItemsShape(NamedShape("InputProof")),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "OperationMaturity": StructShape(
        MappingProxyType(
            {
                "level": NamedShape("Maturity"),
                "source": NamedShape("MaturitySource"),
                "reason": NamedShape("Reason"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "OperationRef": StructShape(
        MappingProxyType({"kind": NamedShape("DeclarationKind"), "id": NamedShape("OperationId")}),
    ),
    "OperationResource": StructShape(MappingProxyType({})),
    "OperationScope": StructShape(
        MappingProxyType(
            {"scope": NamedShape("ScopeId"), "source": NamedShape("ValueSource"), "origin": NamedShape("Origin")},
        ),
    ),
    "OptionalAccess": StructShape(
        MappingProxyType(
            {
                "identity": NamedShape("IdentityId"),
                "schemes": ItemsShape(NamedShape("SchemeId")),
                "reason": NamedShape("Reason"),
                "onRefused": NamedShape("RefusedCredential"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "Origin": StructShape(MappingProxyType({})),
    "OutputEnumForm": OpenEnumShape(("enum", "open"), False),
    "OverLimitPolicy": OpenEnumShape(("reject", "clamp"), False),
    "Owner": StructShape(MappingProxyType({"kind": NamedShape("OwnerKind"), "origin": NamedShape("Origin")})),
    "OwnerKind": OpenEnumShape(("caller",), False),
    "PackRef": StructShape(MappingProxyType({})),
    "Paging": StructShape(
        MappingProxyType(
            {
                "style": NamedShape("PagingId"),
                "overLimit": NamedShape("OverLimitPolicy"),
                "token": NamedShape("PagingToken"),
                "sortKeys": ItemsShape(NamedShape("SortKey")),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "PagingLink": StructShape(MappingProxyType({"role": NamedShape("UrlRole")})),
    "PagingParamPlacement": OpenEnumShape(("query", "header"), False),
    "PagingParamStyle": OpenEnumShape(("signed", "pair", "keyed", "split"), False),
    "PagingPosition": OpenEnumShape(("cursor", "page", "offset", "since"), False),
    "PagingRequestRole": StructShape(
        MappingProxyType(
            {
                "role": NamedShape("PagingRole"),
                "in": NamedShape("PagingParamPlacement"),
                "style": NamedShape("PagingParamStyle"),
            },
        ),
    ),
    "PagingResponse": StructShape(
        MappingProxyType(
            {
                "body": NamedShape("Template"),
                "meta": ItemsShape(NamedShape("NamedTemplate")),
                "headers": ItemsShape(NamedShape("HeaderTemplate")),
                "links": ItemsShape(NamedShape("PagingLink")),
            },
        ),
    ),
    "PagingRole": OpenEnumShape(("cursor", "after", "before", "page", "offset", "since", "limit", "sort"), False),
    "PagingStyle": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("PagingId"),
                "origin": NamedShape("Origin"),
                "position": NamedShape("PagingPosition"),
                "absent": NamedShape("Absent"),
                "request": ItemsShape(NamedShape("PagingRequestRole")),
                "response": NamedShape("PagingResponse"),
                "handlerResult": ItemsShape(NamedShape("HandlerResultMember")),
            },
        ),
    ),
    "PagingToken": OpenEnumShape(("opaque", "instant"), False),
    "Param": StructShape(
        MappingProxyType(
            {
                "type": NamedShape("TypeUse"),
                "wire": NamedShape("QueryWire"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "Params": StructShape(
        MappingProxyType(
            {
                "path": ItemsShape(NamedShape("Param")),
                "query": ItemsShape(NamedShape("Param")),
                "header": ItemsShape(NamedShape("Param")),
            },
        ),
    ),
    "PathApiVersion": StructShape(MappingProxyType({})),
    "PathVersion": StructShape(
        MappingProxyType({"value": NamedShape("PathVersionMode"), "origin": NamedShape("Origin")}),
    ),
    "PathVersionMode": OpenEnumShape(("prefix", "none"), False),
    "Pattern": StructShape(MappingProxyType({})),
    "PlainMemberName": StructShape(MappingProxyType({})),
    "PlainTextPart": StructShape(MappingProxyType({})),
    "Principal": UnionShape(
        "kind",
        False,
        MappingProxyType({"schema": "SchemaPrincipal", "variants": "VariantsPrincipal"}),
    ),
    "PrincipalRequirement": StructShape(MappingProxyType({"origin": NamedShape("Origin")})),
    "ProofPlacement": OpenEnumShape(("body", "header"), False),
    "Property": StructShape(
        MappingProxyType(
            {
                "type": NamedShape("TypeUse"),
                "restrictedTo": NamedShape("FieldRestriction"),
                "codeName": NamedShape("Name"),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "PublicAccess": StructShape(MappingProxyType({"reason": NamedShape("Reason"), "origin": NamedShape("Origin")})),
    "QueryScheme": StructShape(MappingProxyType({"id": NamedShape("SchemeId"), "origin": NamedShape("Origin")})),
    "QueryStyle": OpenEnumShape(("form", "deepObject"), False),
    "QueryWire": StructShape(
        MappingProxyType({"kind": NamedShape("QueryWireKind"), "style": NamedShape("QueryStyle")}),
    ),
    "QueryWireKind": OpenEnumShape(("number", "boolean", "list", "text", "object"), False),
    "RefTypeUse": StructShape(
        MappingProxyType(
            {"schema": NamedShape("SchemaId"), "unknownKeys": NamedShape("UnknownKeys"), "docs": NamedShape("Docs")},
        ),
    ),
    "Refinements": StructShape(
        MappingProxyType(
            {
                "pattern": NamedShape("Pattern"),
                "minimum": NamedShape("DecimalLiteral"),
                "maximum": NamedShape("DecimalLiteral"),
                "exclusiveMinimum": NamedShape("DecimalLiteral"),
                "exclusiveMaximum": NamedShape("DecimalLiteral"),
                "multipleOf": NamedShape("DecimalLiteral"),
            },
        ),
    ),
    "RefuseUnknownQuery": StructShape(MappingProxyType({})),
    "RefusedCredential": OpenEnumShape(("anonymous", "reject"), True),
    "Requirement": UnionShape("kind", True, MappingProxyType({"right": "RightRequirement", "rule": "RuleRequirement"})),
    "RequirementSubject": StructShape(MappingProxyType({"source": NamedShape("ValueSource")})),
    "ResourceSubject": StructShape(MappingProxyType({"type": NamedShape("Name"), "idSchema": NamedShape("TypeUse")})),
    "Response": StructShape(
        MappingProxyType(
            {
                "body": NamedShape("TypeUse"),
                "shape": NamedShape("ResponseShape"),
                "headers": ItemsShape(NamedShape("ResponseHeader")),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
                "docs": NamedShape("Docs"),
            },
        ),
    ),
    "ResponseHeader": StructShape(
        MappingProxyType(
            {
                "type": NamedShape("TypeUse"),
                "semantic": NamedShape("ResponseHeaderSemantic"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "ResponseHeaderSemantic": OpenEnumShape(
        ("deadline", "traceContext", "actorSurface", "versionToken", "deprecation", "sunset", "successorLink"),
        False,
    ),
    "ResponseShape": OpenEnumShape(("item", "table", "list", "page", "empty", "binary", "redirect"), False),
    "RetryHeader": StructShape(
        MappingProxyType({"unit": NamedShape("RetryUnit"), "derivedFrom": NamedShape("DerivedFrom")}),
    ),
    "RetryUnit": OpenEnumShape(("s", "ms"), False),
    "Right": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("RightId"),
                "params": NamedShape("SchemaRef"),
                "subject": NamedShape("RightSubject"),
                "guest": NamedShape("Reason"),
                "errors": ItemsShape(NamedShape("ErrorCode")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
                "codeName": NamedShape("Name"),
            },
        ),
    ),
    "RightRequirement": StructShape(
        MappingProxyType(
            {
                "right": NamedShape("RightId"),
                "subject": NamedShape("RequirementSubject"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "RightSubject": UnionShape(
        "kind",
        True,
        MappingProxyType({"none": "NoSubject", "scope": "ScopeSubject", "resource": "ResourceSubject"}),
    ),
    "Rule": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("RuleId"),
                "params": NamedShape("SchemaRef"),
                "proof": NamedShape("RuleProof"),
                "errors": ItemsShape(NamedShape("ErrorCode")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "RuleProof": StructShape(MappingProxyType({"in": NamedShape("ProofPlacement"), "schema": NamedShape("TypeUse")})),
    "RuleRequirement": StructShape(
        MappingProxyType(
            {
                "rule": NamedShape("RuleId"),
                "bucket": NamedShape("BucketId"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "Scalar": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("ScalarId"),
                "name": NamedShape("Name"),
                "type": NamedShape("ScalarTypeUse"),
                "directions": ItemsShape(NamedShape("Direction")),
                "docs": NamedShape("Docs"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "ScalarType": OpenEnumShape(("string", "integer", "number", "boolean"), False),
    "ScalarTypeUse": StructShape(
        MappingProxyType(
            {
                "type": NamedShape("ScalarType"),
                "scalar": NamedShape("ScalarId"),
                "refinements": NamedShape("Refinements"),
                "content": NamedShape("JsonContent"),
                "docs": NamedShape("Docs"),
            },
        ),
    ),
    "Schema": UnionShape(
        "kind",
        False,
        MappingProxyType({"object": "ObjectSchema", "map": "MapSchema", "union": "UnionSchema"}),
    ),
    "SchemaPrincipal": StructShape(MappingProxyType({"schema": NamedShape("SchemaRef")})),
    "SchemaRef": NamedShape("SchemaId"),
    "Scheme": UnionShape(
        "kind",
        True,
        MappingProxyType(
            {
                "cookie": "CookieScheme",
                "header": "HeaderScheme",
                "query": "QueryScheme",
                "bearer": "BearerScheme",
                "basic": "BasicScheme",
                "signature": "SignatureScheme",
            },
        ),
    ),
    "SchemeKey": UnionShape("kind", True, MappingProxyType({"value": "ValueSchemeKey", "from": "SourceSchemeKey"})),
    "Scope": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("ScopeId"),
                "idSchema": NamedShape("TypeUse"),
                "within": NamedShape("ScopeId"),
                "errors": ItemsShape(NamedShape("ErrorCode")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "ScopeSubject": StructShape(MappingProxyType({"scope": NamedShape("ScopeId")})),
    "Service": StructShape(
        MappingProxyType(
            {"id": NamedShape("ServiceId"), "maturity": NamedShape("Maturity"), "origin": NamedShape("Origin")},
        ),
    ),
    "Shape": StructShape(
        MappingProxyType({"body": NamedShape("Template"), "headers": ItemsShape(NamedShape("HeaderTemplate"))}),
    ),
    "SignatureEncoding": OpenEnumShape(("hex", "base64"), False),
    "SignatureScheme": StructShape(
        MappingProxyType(
            {"id": NamedShape("SchemeId"), "signature": NamedShape("SignatureVerify"), "origin": NamedShape("Origin")},
        ),
    ),
    "SignatureVerify": UnionShape(
        "verify",
        True,
        MappingProxyType({"template": "TemplateSignature", "application": "ApplicationSignature"}),
    ),
    "SignedIdentity": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("IdentityId"),
                "signed": NamedShape("SchemeId"),
                "principal": NamedShape("Principal"),
                "unknownKeys": NamedShape("KeysPolicy"),
                "errors": ItemsShape(NamedShape("ErrorCode")),
                "headers": ItemsShape(NamedShape("IdentityHeaderUse")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "SlotMemberName": StructShape(MappingProxyType({"slot": NamedShape("Slot")})),
    "SlotTemplate": StructShape(MappingProxyType({"slot": NamedShape("Slot")})),
    "SlotTextPart": StructShape(MappingProxyType({"slot": NamedShape("Slot")})),
    "SortKey": StructShape(
        MappingProxyType(
            {
                "right": NamedShape("RightId"),
                "subject": NamedShape("FieldRightSubject"),
                "derivedFrom": NamedShape("DerivedFrom"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "SourceLocation": StructShape(MappingProxyType({})),
    "SourceMap": StructShape(MappingProxyType({"locations": ValuesShape(NamedShape("SourceLocation"))})),
    "SourceSchemeKey": StructShape(MappingProxyType({"from": NamedShape("ValueSource")})),
    "SuccessShapes": StructShape(
        MappingProxyType(
            {
                "item": NamedShape("Shape"),
                "table": NamedShape("Shape"),
                "list": NamedShape("Shape"),
                "page": NamedShape("Shape"),
            },
        ),
    ),
    "Surface": StructShape(
        MappingProxyType(
            {"name": NamedShape("Name"), "pathVersion": NamedShape("PathVersionMode"), "origin": NamedShape("Origin")},
        ),
    ),
    "Template": UnionShape(
        "kind",
        False,
        MappingProxyType(
            {
                "slot": "SlotTemplate",
                "text": "TextTemplate",
                "literal": "LiteralTemplate",
                "object": "ObjectTemplate",
                "array": "ArrayTemplate",
                "each": "EachTemplate",
            },
        ),
    ),
    "TemplateSignature": StructShape(
        MappingProxyType({"encoding": NamedShape("SignatureEncoding"), "key": NamedShape("SchemeKey")}),
    ),
    "TextPart": UnionShape("kind", False, MappingProxyType({"text": "PlainTextPart", "slot": "SlotTextPart"})),
    "TextTemplate": StructShape(MappingProxyType({"parts": ItemsShape(NamedShape("TextPart"))})),
    "TypeUse": UnionShape(
        "kind",
        False,
        MappingProxyType(
            {
                "ref": "RefTypeUse",
                "opaque": "OpaqueTypeUse",
                "file": "FileTypeUse",
                "enum": "EnumTypeUse",
                "scalar": "ScalarTypeUse",
                "array": "ArrayTypeUse",
            },
        ),
    ),
    "UnionSchema": StructShape(
        MappingProxyType(
            {
                "tag": NamedShape("UnionTag"),
                "variants": ItemsShape(NamedShape("UnionVariant")),
                "id": NamedShape("SchemaId"),
                "name": NamedShape("Name"),
                "directions": ItemsShape(NamedShape("Direction")),
                "docs": NamedShape("Docs"),
                "extensions": NamedShape("Extensions"),
                "origin": NamedShape("Origin"),
            },
        ),
    ),
    "UnionTag": UnionShape("in", False, MappingProxyType({"body": "BodyUnionTag", "header": "HeaderUnionTag"})),
    "UnionVariant": StructShape(MappingProxyType({"schema": NamedShape("SchemaId"), "docs": NamedShape("Docs")})),
    "UnknownKeys": StructShape(
        MappingProxyType(
            {
                "policy": NamedShape("UnknownKeysPolicy"),
                "reason": NamedShape("Reason"),
                "origin": NamedShape("Origin"),
                "derivedFrom": NamedShape("DerivedFrom"),
            },
        ),
    ),
    "UnknownKeysPolicy": OpenEnumShape(("refuse", "ignore", "keep"), True),
    "UnknownQuery": UnionShape(
        "policy",
        True,
        MappingProxyType({"refuse": "RefuseUnknownQuery", "ignore": "IgnoreUnknownQuery"}),
    ),
    "UrlForm": OpenEnumShape(("relative", "absolute"), False),
    "UrlRole": OpenEnumShape(("self", "first", "previous", "next", "last"), False),
    "ValueSchemeKey": StructShape(MappingProxyType({})),
    "ValueSource": StructShape(MappingProxyType({"in": NamedShape("ValueSourceIn")})),
    "ValueSourceIn": OpenEnumShape(
        (
            "path",
            "query",
            "header",
            "body",
            "principal",
            "scope",
            "host",
            "subdomain",
            "address",
            "resolver",
            "holderField",
        ),
        True,
    ),
    "VariantsPrincipal": StructShape(MappingProxyType({"variants": ValuesShape(NamedShape("SchemaRef"))})),
    "VocabularyEnumSource": StructShape(MappingProxyType({})),
    "WireFormat": StructShape(
        MappingProxyType(
            {
                "id": NamedShape("FormatId"),
                "origin": NamedShape("Origin"),
                "absent": NamedShape("Absent"),
                "success": NamedShape("SuccessShapes"),
                "meta": ValuesShape(NamedShape("MetaMember")),
                "error": NamedShape("ErrorShape"),
            },
        ),
    ),
}

SHAPES: Final[Mapping[str, Shape]] = MappingProxyType(_SHAPES)
