# Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
# Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

"""The IR model (ADR 0010): one class per IR definition, read from and written back to JSON."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as _dataclass_field
from enum import StrEnum
from typing import Literal, final

from seampact.ir.hydration import (
    OMITTED,
    FrozenJson,
    IrModelError,
    JsonValue,
    Omitted,
    UnknownEnumValue,
    UnknownVariant,
    boolean_reader,
    copy_list,
    copy_map,
    encode_list,
    encode_map,
    encode_model,
    encode_open_enum,
    encode_plain,
    expect_tag,
    extensions_reader,
    freeze,
    freeze_extensions,
    freeze_object,
    integer_reader,
    list_reader,
    map_reader,
    opaque_reader,
    open_enum_reader,
    optional,
    optional_opaque,
    read_object,
    required,
    string_reader,
    thaw,
    thaw_extensions,
    thaw_object,
    union_tag,
)


class Access(ABC):
    """Who may call the operation. Must act: an unknown tag makes the IR invalid for every reader."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Access:
        members = read_object(value, "Access")
        tag = union_tag(members, "kind", "Access")
        match tag:
            case "identity":
                return IdentityAccess.from_json(members)
            case "optional":
                return OptionalAccess.from_json(members)
            case "public":
                return PublicAccess.from_json(members)
            case _:
                return AccessUnknown(kind=tag, raw=freeze_object(members, "Access"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class AccessUnknown(Access, UnknownVariant):
    """A variant of Access this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("identity", "optional", "public"):
            raise IrModelError("AccessUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("AccessUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "AccessUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class ApiVersion(ABC):
    """The api version: the path version number, or a label when every surface's pathVersion is 'none'."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> ApiVersion:
        members = read_object(value, "ApiVersion")
        tag = union_tag(members, "kind", "ApiVersion")
        match tag:
            case "path":
                return PathApiVersion.from_json(members)
            case "label":
                return LabelApiVersion.from_json(members)
            case _:
                return ApiVersionUnknown(kind=tag, raw=freeze_object(members, "ApiVersion"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ApiVersionUnknown(ApiVersion, UnknownVariant):
    """A variant of ApiVersion this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("path", "label"):
            raise IrModelError("ApiVersionUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("ApiVersionUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "ApiVersionUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Csrf(ABC):
    """The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with
    its reason (invariant ir.csrf.cookie). Must act: an unknown tag makes the IR invalid for every reader.
    """

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Csrf:
        members = read_object(value, "Csrf")
        tag = union_tag(members, "kind", "Csrf")
        match tag:
            case "derived":
                return DerivedCsrf.from_json(members)
            case "exempt":
                return ExemptCsrf.from_json(members)
            case _:
                return CsrfUnknown(kind=tag, raw=freeze_object(members, "Csrf"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CsrfUnknown(Csrf, UnknownVariant):
    """A variant of Csrf this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("derived", "exempt"):
            raise IrModelError("CsrfUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("CsrfUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "CsrfUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class EnumSource(ABC):
    """Where an enum's values come from: a shared vocabulary or another enum."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> EnumSource:
        members = read_object(value, "EnumSource")
        tag = union_tag(members, "kind", "EnumSource")
        match tag:
            case "vocabulary":
                return VocabularyEnumSource.from_json(members)
            case "enum":
                return CatalogueEnumSource.from_json(members)
            case _:
                return EnumSourceUnknown(kind=tag, raw=freeze_object(members, "EnumSource"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class EnumSourceUnknown(EnumSource, UnknownVariant):
    """A variant of EnumSource this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("vocabulary", "enum"):
            raise IrModelError("EnumSourceUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("EnumSourceUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "EnumSourceUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Idempotency(ABC):
    """The idempotency key of an unsafe operation: derived settings, or an exemption with its reason. Must act: an
    unknown tag makes the IR invalid for every reader.
    """

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Idempotency:
        members = read_object(value, "Idempotency")
        tag = union_tag(members, "kind", "Idempotency")
        match tag:
            case "derived":
                return DerivedIdempotency.from_json(members)
            case "exempt":
                return ExemptIdempotency.from_json(members)
            case _:
                return IdempotencyUnknown(kind=tag, raw=freeze_object(members, "Idempotency"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IdempotencyUnknown(Idempotency, UnknownVariant):
    """A variant of Idempotency this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("derived", "exempt"):
            raise IrModelError("IdempotencyUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("IdempotencyUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "IdempotencyUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Identity(ABC):
    """An identity (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every
    reader.
    """

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Identity:
        members = read_object(value, "Identity")
        tag = union_tag(members, "kind", "Identity")
        match tag:
            case "credential":
                return CredentialIdentity.from_json(members)
            case "signed":
                return SignedIdentity.from_json(members)
            case _:
                return IdentityUnknown(kind=tag, raw=freeze_object(members, "Identity"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IdentityUnknown(Identity, UnknownVariant):
    """A variant of Identity this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("credential", "signed"):
            raise IrModelError("IdentityUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("IdentityUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "IdentityUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class KeysPolicy(ABC):
    """Unknown keys of a signed identity's payload: ignored or kept, with the reason. Must act: an unknown tag makes the
    IR invalid for every reader.
    """

    __slots__ = ()

    policy: str
    """The tag member 'policy': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> KeysPolicy:
        members = read_object(value, "KeysPolicy")
        tag = union_tag(members, "policy", "KeysPolicy")
        match tag:
            case "ignore":
                return IgnoreKeysPolicy.from_json(members)
            case "keep":
                return KeepKeysPolicy.from_json(members)
            case _:
                return KeysPolicyUnknown(policy=tag, raw=freeze_object(members, "KeysPolicy"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class KeysPolicyUnknown(KeysPolicy, UnknownVariant):
    """A variant of KeysPolicy this IR revision does not know, kept raw; its tag is the raw object's."""

    policy: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.policy in ("ignore", "keep"):
            raise IrModelError("KeysPolicyUnknown: the policy is a known one")
        if self.raw.get("policy") != self.policy:
            raise IrModelError("KeysPolicyUnknown: raw does not carry the policy")
        object.__setattr__(self, "raw", freeze_object(self.raw, "KeysPolicyUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class MemberName(ABC):
    """The name of an object template member: literal text, or a slot."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> MemberName:
        members = read_object(value, "MemberName")
        tag = union_tag(members, "kind", "MemberName")
        match tag:
            case "text":
                return PlainMemberName.from_json(members)
            case "slot":
                return SlotMemberName.from_json(members)
            case _:
                return MemberNameUnknown(kind=tag, raw=freeze_object(members, "MemberName"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class MemberNameUnknown(MemberName, UnknownVariant):
    """A variant of MemberName this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("text", "slot"):
            raise IrModelError("MemberNameUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("MemberNameUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "MemberNameUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Principal(ABC):
    """The principal schema: one schema, or one per credential variant."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Principal:
        members = read_object(value, "Principal")
        tag = union_tag(members, "kind", "Principal")
        match tag:
            case "schema":
                return SchemaPrincipal.from_json(members)
            case "variants":
                return VariantsPrincipal.from_json(members)
            case _:
                return PrincipalUnknown(kind=tag, raw=freeze_object(members, "Principal"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PrincipalUnknown(Principal, UnknownVariant):
    """A variant of Principal this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("schema", "variants"):
            raise IrModelError("PrincipalUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("PrincipalUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "PrincipalUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Requirement(ABC):
    """A requirement, in declared order (FR-5). Must act: an unknown tag makes the IR invalid for every reader."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Requirement:
        members = read_object(value, "Requirement")
        tag = union_tag(members, "kind", "Requirement")
        match tag:
            case "right":
                return RightRequirement.from_json(members)
            case "rule":
                return RuleRequirement.from_json(members)
            case _:
                return RequirementUnknown(kind=tag, raw=freeze_object(members, "Requirement"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RequirementUnknown(Requirement, UnknownVariant):
    """A variant of Requirement this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("right", "rule"):
            raise IrModelError("RequirementUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("RequirementUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "RequirementUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class RightSubject(ABC):
    """The subject a right is checked against. Must act: an unknown tag makes the IR invalid for every reader."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> RightSubject:
        members = read_object(value, "RightSubject")
        tag = union_tag(members, "kind", "RightSubject")
        match tag:
            case "none":
                return NoSubject.from_json(members)
            case "scope":
                return ScopeSubject.from_json(members)
            case "resource":
                return ResourceSubject.from_json(members)
            case _:
                return RightSubjectUnknown(kind=tag, raw=freeze_object(members, "RightSubject"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RightSubjectUnknown(RightSubject, UnknownVariant):
    """A variant of RightSubject this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("none", "scope", "resource"):
            raise IrModelError("RightSubjectUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("RightSubjectUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "RightSubjectUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Schema(ABC):
    """A named schema: objects, maps and unions are always named (ADR 0004 section 5)."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Schema:
        members = read_object(value, "Schema")
        tag = union_tag(members, "kind", "Schema")
        match tag:
            case "object":
                return ObjectSchema.from_json(members)
            case "map":
                return MapSchema.from_json(members)
            case "union":
                return UnionSchema.from_json(members)
            case _:
                return SchemaUnknown(kind=tag, raw=freeze_object(members, "Schema"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SchemaUnknown(Schema, UnknownVariant):
    """A variant of Schema this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("object", "map", "union"):
            raise IrModelError("SchemaUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("SchemaUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "SchemaUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Scheme(ABC):
    """A security scheme (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for
    every reader.
    """

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Scheme:
        members = read_object(value, "Scheme")
        tag = union_tag(members, "kind", "Scheme")
        match tag:
            case "cookie":
                return CookieScheme.from_json(members)
            case "header":
                return HeaderScheme.from_json(members)
            case "query":
                return QueryScheme.from_json(members)
            case "bearer":
                return BearerScheme.from_json(members)
            case "basic":
                return BasicScheme.from_json(members)
            case "signature":
                return SignatureScheme.from_json(members)
            case _:
                return SchemeUnknown(kind=tag, raw=freeze_object(members, "Scheme"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SchemeUnknown(Scheme, UnknownVariant):
    """A variant of Scheme this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("cookie", "header", "query", "bearer", "basic", "signature"):
            raise IrModelError("SchemeUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("SchemeUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "SchemeUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class SchemeKey(ABC):
    """The key a signature is verified with: an id the application resolves to its secret, never the secret itself,
    written as a value or read from the request. Must act: an unknown tag makes the IR invalid for every reader.
    """

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> SchemeKey:
        members = read_object(value, "SchemeKey")
        tag = union_tag(members, "kind", "SchemeKey")
        match tag:
            case "value":
                return ValueSchemeKey.from_json(members)
            case "from":
                return SourceSchemeKey.from_json(members)
            case _:
                return SchemeKeyUnknown(kind=tag, raw=freeze_object(members, "SchemeKey"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SchemeKeyUnknown(SchemeKey, UnknownVariant):
    """A variant of SchemeKey this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("value", "from"):
            raise IrModelError("SchemeKeyUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("SchemeKeyUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "SchemeKeyUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class SignatureVerify(ABC):
    """How a signature is verified (ADR 0004 section 4). Must act: an unknown tag makes the IR invalid for every
    reader.
    """

    __slots__ = ()

    verify: str
    """The tag member 'verify': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> SignatureVerify:
        members = read_object(value, "SignatureVerify")
        tag = union_tag(members, "verify", "SignatureVerify")
        match tag:
            case "template":
                return TemplateSignature.from_json(members)
            case "application":
                return ApplicationSignature.from_json(members)
            case _:
                return SignatureVerifyUnknown(verify=tag, raw=freeze_object(members, "SignatureVerify"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SignatureVerifyUnknown(SignatureVerify, UnknownVariant):
    """A variant of SignatureVerify this IR revision does not know, kept raw; its tag is the raw object's."""

    verify: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.verify in ("template", "application"):
            raise IrModelError("SignatureVerifyUnknown: the verify is a known one")
        if self.raw.get("verify") != self.verify:
            raise IrModelError("SignatureVerifyUnknown: raw does not carry the verify")
        object.__setattr__(self, "raw", freeze_object(self.raw, "SignatureVerifyUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Template(ABC):
    """A template of the template language (ADR 0002 sections 13 and 14)."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> Template:
        members = read_object(value, "Template")
        tag = union_tag(members, "kind", "Template")
        match tag:
            case "slot":
                return SlotTemplate.from_json(members)
            case "text":
                return TextTemplate.from_json(members)
            case "literal":
                return LiteralTemplate.from_json(members)
            case "object":
                return ObjectTemplate.from_json(members)
            case "array":
                return ArrayTemplate.from_json(members)
            case "each":
                return EachTemplate.from_json(members)
            case _:
                return TemplateUnknown(kind=tag, raw=freeze_object(members, "Template"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class TemplateUnknown(Template, UnknownVariant):
    """A variant of Template this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("slot", "text", "literal", "object", "array", "each"):
            raise IrModelError("TemplateUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("TemplateUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "TemplateUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class TextPart(ABC):
    """A part of a text template: literal text, or a slot with its path."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> TextPart:
        members = read_object(value, "TextPart")
        tag = union_tag(members, "kind", "TextPart")
        match tag:
            case "text":
                return PlainTextPart.from_json(members)
            case "slot":
                return SlotTextPart.from_json(members)
            case _:
                return TextPartUnknown(kind=tag, raw=freeze_object(members, "TextPart"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class TextPartUnknown(TextPart, UnknownVariant):
    """A variant of TextPart this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("text", "slot"):
            raise IrModelError("TextPartUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("TextPartUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "TextPartUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class TypeUse(ABC):
    """What a property, item, body or parameter is (ADR 0004 section 5)."""

    __slots__ = ()

    kind: str
    """The tag member 'kind': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> TypeUse:
        members = read_object(value, "TypeUse")
        tag = union_tag(members, "kind", "TypeUse")
        match tag:
            case "ref":
                return RefTypeUse.from_json(members)
            case "opaque":
                return OpaqueTypeUse.from_json(members)
            case "file":
                return FileTypeUse.from_json(members)
            case "enum":
                return EnumTypeUse.from_json(members)
            case "scalar":
                return ScalarTypeUse.from_json(members)
            case "array":
                return ArrayTypeUse.from_json(members)
            case _:
                return TypeUseUnknown(kind=tag, raw=freeze_object(members, "TypeUse"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class TypeUseUnknown(TypeUse, UnknownVariant):
    """A variant of TypeUse this IR revision does not know, kept raw; its tag is the raw object's."""

    kind: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.kind in ("ref", "opaque", "file", "enum", "scalar", "array"):
            raise IrModelError("TypeUseUnknown: the kind is a known one")
        if self.raw.get("kind") != self.kind:
            raise IrModelError("TypeUseUnknown: raw does not carry the kind")
        object.__setattr__(self, "raw", freeze_object(self.raw, "TypeUseUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class UnionTag(ABC):
    """Where a union's tag is read; 'header' only for a route's whole input."""

    __slots__ = ()

    in_: str
    """The tag member 'in': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> UnionTag:
        members = read_object(value, "UnionTag")
        tag = union_tag(members, "in", "UnionTag")
        match tag:
            case "body":
                return BodyUnionTag.from_json(members)
            case "header":
                return HeaderUnionTag.from_json(members)
            case _:
                return UnionTagUnknown(in_=tag, raw=freeze_object(members, "UnionTag"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class UnionTagUnknown(UnionTag, UnknownVariant):
    """A variant of UnionTag this IR revision does not know, kept raw; its tag is the raw object's."""

    in_: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.in_ in ("body", "header"):
            raise IrModelError("UnionTagUnknown: the in is a known one")
        if self.raw.get("in") != self.in_:
            raise IrModelError("UnionTagUnknown: raw does not carry the in")
        object.__setattr__(self, "raw", freeze_object(self.raw, "UnionTagUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class UnknownQuery(ABC):
    """Undeclared query keys. Must act: an unknown tag makes the IR invalid for every reader."""

    __slots__ = ()

    policy: str
    """The tag member 'policy': it picks the variant."""

    @staticmethod
    def from_json(value: object) -> UnknownQuery:
        members = read_object(value, "UnknownQuery")
        tag = union_tag(members, "policy", "UnknownQuery")
        match tag:
            case "refuse":
                return RefuseUnknownQuery.from_json(members)
            case "ignore":
                return IgnoreUnknownQuery.from_json(members)
            case _:
                return UnknownQueryUnknown(policy=tag, raw=freeze_object(members, "UnknownQuery"))

    @abstractmethod
    def to_json(self) -> dict[str, JsonValue]: ...


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class UnknownQueryUnknown(UnknownQuery, UnknownVariant):
    """A variant of UnknownQuery this IR revision does not know, kept raw; its tag is the raw object's."""

    policy: str
    raw: Mapping[str, FrozenJson]

    def __post_init__(self) -> None:
        if self.policy in ("refuse", "ignore"):
            raise IrModelError("UnknownQueryUnknown: the policy is a known one")
        if self.raw.get("policy") != self.policy:
            raise IrModelError("UnknownQueryUnknown: raw does not carry the policy")
        object.__setattr__(self, "raw", freeze_object(self.raw, "UnknownQueryUnknown.raw"))

    def to_json(self) -> dict[str, JsonValue]:
        return thaw_object(self.raw)


class Absent(StrEnum):
    OMIT = "omit"
    NULL = "null"


@final
@dataclass(frozen=True, slots=True)
class AbsentUnknown(UnknownEnumValue):
    """A value of Absent this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in Absent:
            raise IrModelError("AbsentUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Api:
    """The api (ADR 0004 section 2)."""

    id: str
    name: Name
    version: ApiVersion
    kind: ApiKind | ApiKindUnknown
    path_version: PathVersion
    role: ApiRole | ApiRoleUnknown | None = None
    maturity: Maturity | MaturityUnknown
    caller: ApiCaller | None = None
    compat: Compat
    wire: ApiWire
    surfaces: Mapping[str, Surface]
    documents: Mapping[str, ApiDocument]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "surfaces", copy_map(self.surfaces))
        object.__setattr__(self, "documents", copy_map(self.documents))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Api.extensions"))

    @staticmethod
    def from_json(value: object) -> Api:
        members = read_object(value, "Api")
        return Api(
            id=required(members, "id", "Api", string_reader("Api.id")),
            name=required(members, "name", "Api", Name.from_json),
            version=required(members, "version", "Api", ApiVersion.from_json),
            kind=required(members, "kind", "Api", open_enum_reader("Api.kind", ApiKind, ApiKindUnknown)),
            path_version=required(members, "pathVersion", "Api", PathVersion.from_json),
            role=optional(members, "role", open_enum_reader("Api.role", ApiRole, ApiRoleUnknown)),
            maturity=required(members, "maturity", "Api", open_enum_reader("Api.maturity", Maturity, MaturityUnknown)),
            caller=optional(members, "caller", ApiCaller.from_json),
            compat=required(members, "compat", "Api", Compat.from_json),
            wire=required(members, "wire", "Api", ApiWire.from_json),
            surfaces=required(members, "surfaces", "Api", map_reader("Api.surfaces", Surface.from_json)),
            documents=required(members, "documents", "Api", map_reader("Api.documents", ApiDocument.from_json)),
            docs=required(members, "docs", "Api", Docs.from_json),
            extensions=required(members, "extensions", "Api", extensions_reader("Api.extensions")),
            origin=required(members, "origin", "Api", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["name"] = self.name.to_json()
        json["version"] = self.version.to_json()
        json["kind"] = encode_open_enum(self.kind)
        json["pathVersion"] = self.path_version.to_json()
        if self.role is not None:
            json["role"] = encode_open_enum(self.role)
        json["maturity"] = encode_open_enum(self.maturity)
        if self.caller is not None:
            json["caller"] = self.caller.to_json()
        json["compat"] = self.compat.to_json()
        json["wire"] = self.wire.to_json()
        json["surfaces"] = encode_map(self.surfaces, encode_model)
        json["documents"] = encode_map(self.documents, encode_model)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ApiCaller:
    identity: IdentityId
    right: RightId

    @staticmethod
    def from_json(value: object) -> ApiCaller:
        members = read_object(value, "ApiCaller")
        return ApiCaller(
            identity=required(members, "identity", "ApiCaller", string_reader("ApiCaller.identity")),
            right=required(members, "right", "ApiCaller", string_reader("ApiCaller.right")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["identity"] = self.identity
        json["right"] = self.right
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ApiDocument:
    surfaces: tuple[SurfaceId, ...]
    internal: InternalPolicy | InternalPolicyUnknown

    def __post_init__(self) -> None:
        object.__setattr__(self, "surfaces", copy_list(self.surfaces))

    @staticmethod
    def from_json(value: object) -> ApiDocument:
        members = read_object(value, "ApiDocument")
        return ApiDocument(
            surfaces=required(
                members,
                "surfaces",
                "ApiDocument",
                list_reader("ApiDocument.surfaces", string_reader("ApiDocument.surfaces[]")),
            ),
            internal=required(
                members,
                "internal",
                "ApiDocument",
                open_enum_reader("ApiDocument.internal", InternalPolicy, InternalPolicyUnknown),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["surfaces"] = encode_list(self.surfaces, encode_plain)
        json["internal"] = encode_open_enum(self.internal)
        return json


class ApiKind(StrEnum):
    """A product api or a service api."""

    PRODUCT = "product"
    SERVICE = "service"


@final
@dataclass(frozen=True, slots=True)
class ApiKindUnknown(UnknownEnumValue):
    """A value of ApiKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ApiKind:
            raise IrModelError("ApiKindUnknown: the value is a known one")


class ApiRole(StrEnum):
    """The role of an api."""

    GATEWAY = "gateway"


@final
@dataclass(frozen=True, slots=True)
class ApiRoleUnknown(UnknownEnumValue):
    """A value of ApiRole this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ApiRole:
            raise IrModelError("ApiRoleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ApiWire:
    """The api-wide conventions a target acts on (ADR 0004 section 13)."""

    int64: Int64Wire | Int64WireUnknown
    output_enums: OutputEnumForm | OutputEnumFormUnknown
    urls: UrlForm | UrlFormUnknown

    @staticmethod
    def from_json(value: object) -> ApiWire:
        members = read_object(value, "ApiWire")
        return ApiWire(
            int64=required(members, "int64", "ApiWire", open_enum_reader("ApiWire.int64", Int64Wire, Int64WireUnknown)),
            output_enums=required(
                members,
                "outputEnums",
                "ApiWire",
                open_enum_reader("ApiWire.outputEnums", OutputEnumForm, OutputEnumFormUnknown),
            ),
            urls=required(members, "urls", "ApiWire", open_enum_reader("ApiWire.urls", UrlForm, UrlFormUnknown)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["int64"] = encode_open_enum(self.int64)
        json["outputEnums"] = encode_open_enum(self.output_enums)
        json["urls"] = encode_open_enum(self.urls)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ApplicationSignature(SignatureVerify):
    verify: Literal["application"] = _dataclass_field(default="application", init=False)
    headers: tuple[str, ...]
    key: SchemeKey | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", copy_list(self.headers))

    @staticmethod
    def from_json(value: object) -> ApplicationSignature:
        members = read_object(value, "ApplicationSignature")
        expect_tag(members, "verify", "application", "ApplicationSignature")
        return ApplicationSignature(
            headers=required(
                members,
                "headers",
                "ApplicationSignature",
                list_reader("ApplicationSignature.headers", string_reader("ApplicationSignature.headers[]")),
            ),
            key=optional(members, "key", SchemeKey.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["verify"] = self.verify
        json["headers"] = encode_list(self.headers, encode_plain)
        if self.key is not None:
            json["key"] = self.key.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ArrayTemplate(Template):
    kind: Literal["array"] = _dataclass_field(default="array", init=False)
    items: tuple[Template, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "items", copy_list(self.items))

    @staticmethod
    def from_json(value: object) -> ArrayTemplate:
        members = read_object(value, "ArrayTemplate")
        expect_tag(members, "kind", "array", "ArrayTemplate")
        return ArrayTemplate(
            items=required(members, "items", "ArrayTemplate", list_reader("ArrayTemplate.items", Template.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["items"] = encode_list(self.items, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ArrayTypeUse(TypeUse):
    kind: Literal["array"] = _dataclass_field(default="array", init=False)
    items: TypeUse
    min_items: int | None = None
    max_items: int | None = None
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out:
    Property.nullable holds it (invariant ir.property.nullable).
    """
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""

    def __post_init__(self) -> None:
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> ArrayTypeUse:
        members = read_object(value, "ArrayTypeUse")
        expect_tag(members, "kind", "array", "ArrayTypeUse")
        return ArrayTypeUse(
            items=required(members, "items", "ArrayTypeUse", TypeUse.from_json),
            min_items=optional(members, "minItems", integer_reader("ArrayTypeUse.minItems")),
            max_items=optional(members, "maxItems", integer_reader("ArrayTypeUse.maxItems")),
            nullable=optional(members, "nullable", boolean_reader("ArrayTypeUse.nullable")),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("ArrayTypeUse.examples", opaque_reader("ArrayTypeUse.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["items"] = self.items.to_json()
        if self.min_items is not None:
            json["minItems"] = self.min_items
        if self.max_items is not None:
            json["maxItems"] = self.max_items
        if self.nullable is not None:
            json["nullable"] = self.nullable
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class BasicScheme(Scheme):
    """HTTP basic credentials in the Authorization header."""

    id: SchemeId
    kind: Literal["basic"] = _dataclass_field(default="basic", init=False)
    origin: Origin

    @staticmethod
    def from_json(value: object) -> BasicScheme:
        members = read_object(value, "BasicScheme")
        expect_tag(members, "kind", "basic", "BasicScheme")
        return BasicScheme(
            id=required(members, "id", "BasicScheme", string_reader("BasicScheme.id")),
            origin=required(members, "origin", "BasicScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class BearerFacts:
    """Document-only facts of a bearer scheme."""

    format: str | None = None
    oauth2: OAuth2 | None = None
    open_id_connect_url: str | None = None

    @staticmethod
    def from_json(value: object) -> BearerFacts:
        members = read_object(value, "BearerFacts")
        return BearerFacts(
            format=optional(members, "format", string_reader("BearerFacts.format")),
            oauth2=optional(members, "oauth2", OAuth2.from_json),
            open_id_connect_url=optional(members, "openIdConnectUrl", string_reader("BearerFacts.openIdConnectUrl")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.format is not None:
            json["format"] = self.format
        if self.oauth2 is not None:
            json["oauth2"] = self.oauth2.to_json()
        if self.open_id_connect_url is not None:
            json["openIdConnectUrl"] = self.open_id_connect_url
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class BearerScheme(Scheme):
    """A bearer token in the Authorization header."""

    id: SchemeId
    kind: Literal["bearer"] = _dataclass_field(default="bearer", init=False)
    bearer: BearerFacts | None = None
    origin: Origin

    @staticmethod
    def from_json(value: object) -> BearerScheme:
        members = read_object(value, "BearerScheme")
        expect_tag(members, "kind", "bearer", "BearerScheme")
        return BearerScheme(
            id=required(members, "id", "BearerScheme", string_reader("BearerScheme.id")),
            bearer=optional(members, "bearer", BearerFacts.from_json),
            origin=required(members, "origin", "BearerScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        if self.bearer is not None:
            json["bearer"] = self.bearer.to_json()
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Binding:
    from_: ValueSource
    to: ValueSource
    origin: Origin

    @staticmethod
    def from_json(value: object) -> Binding:
        members = read_object(value, "Binding")
        return Binding(
            from_=required(members, "from", "Binding", ValueSource.from_json),
            to=required(members, "to", "Binding", ValueSource.from_json),
            origin=required(members, "origin", "Binding", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["from"] = self.from_.to_json()
        json["to"] = self.to.to_json()
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class BodyUnionTag(UnionTag):
    in_: Literal["body"] = _dataclass_field(default="body", init=False)
    property: str

    @staticmethod
    def from_json(value: object) -> BodyUnionTag:
        members = read_object(value, "BodyUnionTag")
        expect_tag(members, "in", "body", "BodyUnionTag")
        return BodyUnionTag(
            property=required(members, "property", "BodyUnionTag", string_reader("BodyUnionTag.property")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["in"] = self.in_
        json["property"] = self.property
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Bucket:
    """A rate-limit bucket (ADR 0004 section 4)."""

    id: BucketId
    key: tuple[ValueSource, ...]
    limit: int | None = None
    window_ms: int | None = None
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "key", copy_list(self.key))

    @staticmethod
    def from_json(value: object) -> Bucket:
        members = read_object(value, "Bucket")
        return Bucket(
            id=required(members, "id", "Bucket", string_reader("Bucket.id")),
            key=required(members, "key", "Bucket", list_reader("Bucket.key", ValueSource.from_json)),
            limit=optional(members, "limit", integer_reader("Bucket.limit")),
            window_ms=optional(members, "windowMs", integer_reader("Bucket.windowMs")),
            origin=required(members, "origin", "Bucket", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["key"] = encode_list(self.key, encode_model)
        if self.limit is not None:
            json["limit"] = self.limit
        if self.window_ms is not None:
            json["windowMs"] = self.window_ms
        json["origin"] = self.origin.to_json()
        return json


type BucketId = str
"""The id of a rate-limit bucket: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Cache:
    """Cache settings (ADR 0004 section 7)."""

    family: str
    directives: CacheDirectives | None = None
    """Absent if and only if the family is 'never' (invariant ir.cache.directives)."""
    anonymous: CacheVisibility | CacheVisibilityUnknown
    vary: tuple[str, ...]
    etag: bool
    per_caller_kind: tuple[CallerCacheControl, ...]
    no_store: bool
    """Authoritative: when true the response is never stored, whatever 'directives' hold. True when the family is
    'never' or a response carries a sensitive value: a sensitive property or scalar use in its body or a header's type
    (ADR 0003 section 6, invariant ir.cache.sensitive-no-store).
    """
    origin: Origin
    derived_from: DerivedFrom | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "vary", copy_list(self.vary))
        object.__setattr__(self, "per_caller_kind", copy_list(self.per_caller_kind))

    @staticmethod
    def from_json(value: object) -> Cache:
        members = read_object(value, "Cache")
        return Cache(
            family=required(members, "family", "Cache", string_reader("Cache.family")),
            directives=optional(members, "directives", CacheDirectives.from_json),
            anonymous=required(
                members,
                "anonymous",
                "Cache",
                open_enum_reader("Cache.anonymous", CacheVisibility, CacheVisibilityUnknown),
            ),
            vary=required(members, "vary", "Cache", list_reader("Cache.vary", string_reader("Cache.vary[]"))),
            etag=required(members, "etag", "Cache", boolean_reader("Cache.etag")),
            per_caller_kind=required(
                members,
                "perCallerKind",
                "Cache",
                list_reader("Cache.perCallerKind", CallerCacheControl.from_json),
            ),
            no_store=required(members, "noStore", "Cache", boolean_reader("Cache.noStore")),
            origin=required(members, "origin", "Cache", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["family"] = self.family
        if self.directives is not None:
            json["directives"] = self.directives.to_json()
        json["anonymous"] = encode_open_enum(self.anonymous)
        json["vary"] = encode_list(self.vary, encode_plain)
        json["etag"] = self.etag
        json["perCallerKind"] = encode_list(self.per_caller_kind, encode_model)
        json["noStore"] = self.no_store
        json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CacheDirectives:
    max_age_ms: int
    shared_max_age_ms: int | None = None
    stale_while_revalidate_ms: int | None = None
    stale_if_error_ms: int | None = None
    immutable: bool
    no_cache: bool
    must_revalidate: bool

    @staticmethod
    def from_json(value: object) -> CacheDirectives:
        members = read_object(value, "CacheDirectives")
        return CacheDirectives(
            max_age_ms=required(members, "maxAgeMs", "CacheDirectives", integer_reader("CacheDirectives.maxAgeMs")),
            shared_max_age_ms=optional(members, "sharedMaxAgeMs", integer_reader("CacheDirectives.sharedMaxAgeMs")),
            stale_while_revalidate_ms=optional(
                members,
                "staleWhileRevalidateMs",
                integer_reader("CacheDirectives.staleWhileRevalidateMs"),
            ),
            stale_if_error_ms=optional(members, "staleIfErrorMs", integer_reader("CacheDirectives.staleIfErrorMs")),
            immutable=required(members, "immutable", "CacheDirectives", boolean_reader("CacheDirectives.immutable")),
            no_cache=required(members, "noCache", "CacheDirectives", boolean_reader("CacheDirectives.noCache")),
            must_revalidate=required(
                members,
                "mustRevalidate",
                "CacheDirectives",
                boolean_reader("CacheDirectives.mustRevalidate"),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["maxAgeMs"] = self.max_age_ms
        if self.shared_max_age_ms is not None:
            json["sharedMaxAgeMs"] = self.shared_max_age_ms
        if self.stale_while_revalidate_ms is not None:
            json["staleWhileRevalidateMs"] = self.stale_while_revalidate_ms
        if self.stale_if_error_ms is not None:
            json["staleIfErrorMs"] = self.stale_if_error_ms
        json["immutable"] = self.immutable
        json["noCache"] = self.no_cache
        json["mustRevalidate"] = self.must_revalidate
        return json


class CacheVisibility(StrEnum):
    """Whether a shared cache may store an anonymous response."""

    PUBLIC = "public"
    PRIVATE = "private"


@final
@dataclass(frozen=True, slots=True)
class CacheVisibilityUnknown(UnknownEnumValue):
    """A value of CacheVisibility this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in CacheVisibility:
            raise IrModelError("CacheVisibilityUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CallerCacheControl:
    caller: CallerKind | CallerKindUnknown
    cache_control: str

    @staticmethod
    def from_json(value: object) -> CallerCacheControl:
        members = read_object(value, "CallerCacheControl")
        return CallerCacheControl(
            caller=required(
                members,
                "caller",
                "CallerCacheControl",
                open_enum_reader("CallerCacheControl.caller", CallerKind, CallerKindUnknown),
            ),
            cache_control=required(
                members,
                "cacheControl",
                "CallerCacheControl",
                string_reader("CallerCacheControl.cacheControl"),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["caller"] = encode_open_enum(self.caller)
        json["cacheControl"] = self.cache_control
        return json


class CallerKind(StrEnum):
    ANONYMOUS = "anonymous"
    IDENTIFIED = "identified"


@final
@dataclass(frozen=True, slots=True)
class CallerKindUnknown(UnknownEnumValue):
    """A value of CallerKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in CallerKind:
            raise IrModelError("CallerKindUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CatalogueEnumSource(EnumSource):
    kind: Literal["enum"] = _dataclass_field(default="enum", init=False)
    enum: EnumId

    @staticmethod
    def from_json(value: object) -> CatalogueEnumSource:
        members = read_object(value, "CatalogueEnumSource")
        expect_tag(members, "kind", "enum", "CatalogueEnumSource")
        return CatalogueEnumSource(
            enum=required(members, "enum", "CatalogueEnumSource", string_reader("CatalogueEnumSource.enum")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["enum"] = self.enum
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Compat:
    policy: CompatPolicy | CompatPolicyUnknown

    @staticmethod
    def from_json(value: object) -> Compat:
        members = read_object(value, "Compat")
        return Compat(
            policy=required(
                members,
                "policy",
                "Compat",
                open_enum_reader("Compat.policy", CompatPolicy, CompatPolicyUnknown),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = encode_open_enum(self.policy)
        return json


class CompatPolicy(StrEnum):
    """The compatibility policy the diff checks."""

    ADDITIVE_ONLY = "additive-only"
    NONE = "none"


@final
@dataclass(frozen=True, slots=True)
class CompatPolicyUnknown(UnknownEnumValue):
    """A value of CompatPolicy this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in CompatPolicy:
            raise IrModelError("CompatPolicyUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Concurrency:
    version: ValueSource
    field: str
    derived_from: DerivedFrom

    @staticmethod
    def from_json(value: object) -> Concurrency:
        members = read_object(value, "Concurrency")
        return Concurrency(
            version=required(members, "version", "Concurrency", ValueSource.from_json),
            field=required(members, "field", "Concurrency", string_reader("Concurrency.field")),
            derived_from=required(members, "derivedFrom", "Concurrency", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["version"] = self.version.to_json()
        json["field"] = self.field
        json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ContractIR:
    """One IR document per api (ADR 0004 sections 1 and 2)."""

    ir_version: int
    """1 until 1.0 and through 1.x (ADR 0005 section 2)."""
    ir_revision: int
    """Rises by one with every IR change (ADR 0005 section 2)."""
    kinds: tuple[DeclarationKind | DeclarationKindUnknown, ...]
    features: tuple[Feature, ...]
    api: Api
    packs: tuple[PackRef, ...]
    conventions: Conventions
    formats: Mapping[str, WireFormat]
    pagings: Mapping[str, PagingStyle]
    schemas: Mapping[str, Schema]
    scalars: Mapping[str, Scalar]
    enums: Mapping[str, Enum]
    errors: Mapping[str, ErrorDecl]
    natures: Mapping[str, NatureDecl]
    schemes: Mapping[str, Scheme]
    headers: Mapping[str, HeaderDecl]
    identities: Mapping[str, Identity]
    rights: Mapping[str, Right]
    rules: Mapping[str, Rule]
    scopes: Mapping[str, Scope]
    buckets: Mapping[str, Bucket]
    services: Mapping[str, Service]
    extension_keys: Mapping[str, ExtensionKeyDecl]
    lint: Lint
    operations: tuple[Operation, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "kinds", copy_list(self.kinds))
        object.__setattr__(self, "features", copy_list(self.features))
        object.__setattr__(self, "packs", copy_list(self.packs))
        object.__setattr__(self, "conventions", copy_map(self.conventions))
        object.__setattr__(self, "formats", copy_map(self.formats))
        object.__setattr__(self, "pagings", copy_map(self.pagings))
        object.__setattr__(self, "schemas", copy_map(self.schemas))
        object.__setattr__(self, "scalars", copy_map(self.scalars))
        object.__setattr__(self, "enums", copy_map(self.enums))
        object.__setattr__(self, "errors", copy_map(self.errors))
        object.__setattr__(self, "natures", copy_map(self.natures))
        object.__setattr__(self, "schemes", copy_map(self.schemes))
        object.__setattr__(self, "headers", copy_map(self.headers))
        object.__setattr__(self, "identities", copy_map(self.identities))
        object.__setattr__(self, "rights", copy_map(self.rights))
        object.__setattr__(self, "rules", copy_map(self.rules))
        object.__setattr__(self, "scopes", copy_map(self.scopes))
        object.__setattr__(self, "buckets", copy_map(self.buckets))
        object.__setattr__(self, "services", copy_map(self.services))
        object.__setattr__(self, "extension_keys", copy_map(self.extension_keys))
        object.__setattr__(self, "operations", copy_list(self.operations))

    @staticmethod
    def from_json(value: object) -> ContractIR:
        members = read_object(value, "ContractIR")
        return ContractIR(
            ir_version=required(members, "irVersion", "ContractIR", integer_reader("ContractIR.irVersion")),
            ir_revision=required(members, "irRevision", "ContractIR", integer_reader("ContractIR.irRevision")),
            kinds=required(
                members,
                "kinds",
                "ContractIR",
                list_reader(
                    "ContractIR.kinds",
                    open_enum_reader("ContractIR.kinds[]", DeclarationKind, DeclarationKindUnknown),
                ),
            ),
            features=required(
                members,
                "features",
                "ContractIR",
                list_reader("ContractIR.features", string_reader("ContractIR.features[]")),
            ),
            api=required(members, "api", "ContractIR", Api.from_json),
            packs=required(members, "packs", "ContractIR", list_reader("ContractIR.packs", PackRef.from_json)),
            conventions=required(
                members,
                "conventions",
                "ContractIR",
                map_reader("ContractIR.conventions", ConventionValue.from_json),
            ),
            formats=required(members, "formats", "ContractIR", map_reader("ContractIR.formats", WireFormat.from_json)),
            pagings=required(members, "pagings", "ContractIR", map_reader("ContractIR.pagings", PagingStyle.from_json)),
            schemas=required(members, "schemas", "ContractIR", map_reader("ContractIR.schemas", Schema.from_json)),
            scalars=required(members, "scalars", "ContractIR", map_reader("ContractIR.scalars", Scalar.from_json)),
            enums=required(members, "enums", "ContractIR", map_reader("ContractIR.enums", Enum.from_json)),
            errors=required(members, "errors", "ContractIR", map_reader("ContractIR.errors", ErrorDecl.from_json)),
            natures=required(members, "natures", "ContractIR", map_reader("ContractIR.natures", NatureDecl.from_json)),
            schemes=required(members, "schemes", "ContractIR", map_reader("ContractIR.schemes", Scheme.from_json)),
            headers=required(members, "headers", "ContractIR", map_reader("ContractIR.headers", HeaderDecl.from_json)),
            identities=required(
                members,
                "identities",
                "ContractIR",
                map_reader("ContractIR.identities", Identity.from_json),
            ),
            rights=required(members, "rights", "ContractIR", map_reader("ContractIR.rights", Right.from_json)),
            rules=required(members, "rules", "ContractIR", map_reader("ContractIR.rules", Rule.from_json)),
            scopes=required(members, "scopes", "ContractIR", map_reader("ContractIR.scopes", Scope.from_json)),
            buckets=required(members, "buckets", "ContractIR", map_reader("ContractIR.buckets", Bucket.from_json)),
            services=required(members, "services", "ContractIR", map_reader("ContractIR.services", Service.from_json)),
            extension_keys=required(
                members,
                "extensionKeys",
                "ContractIR",
                map_reader("ContractIR.extensionKeys", ExtensionKeyDecl.from_json),
            ),
            lint=required(members, "lint", "ContractIR", Lint.from_json),
            operations=required(
                members,
                "operations",
                "ContractIR",
                list_reader("ContractIR.operations", Operation.from_json),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["irVersion"] = self.ir_version
        json["irRevision"] = self.ir_revision
        json["kinds"] = encode_list(self.kinds, encode_open_enum)
        json["features"] = encode_list(self.features, encode_plain)
        json["api"] = self.api.to_json()
        json["packs"] = encode_list(self.packs, encode_model)
        json["conventions"] = encode_map(self.conventions, encode_model)
        json["formats"] = encode_map(self.formats, encode_model)
        json["pagings"] = encode_map(self.pagings, encode_model)
        json["schemas"] = encode_map(self.schemas, encode_model)
        json["scalars"] = encode_map(self.scalars, encode_model)
        json["enums"] = encode_map(self.enums, encode_model)
        json["errors"] = encode_map(self.errors, encode_model)
        json["natures"] = encode_map(self.natures, encode_model)
        json["schemes"] = encode_map(self.schemes, encode_model)
        json["headers"] = encode_map(self.headers, encode_model)
        json["identities"] = encode_map(self.identities, encode_model)
        json["rights"] = encode_map(self.rights, encode_model)
        json["rules"] = encode_map(self.rules, encode_model)
        json["scopes"] = encode_map(self.scopes, encode_model)
        json["buckets"] = encode_map(self.buckets, encode_model)
        json["services"] = encode_map(self.services, encode_model)
        json["extensionKeys"] = encode_map(self.extension_keys, encode_model)
        json["lint"] = self.lint.to_json()
        json["operations"] = encode_list(self.operations, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ConventionValue:
    """A resolved convention value with the origin of the node that set it."""

    value: FrozenJson
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", freeze(self.value, "ConventionValue.value"))

    @staticmethod
    def from_json(value: object) -> ConventionValue:
        members = read_object(value, "ConventionValue")
        return ConventionValue(
            value=required(members, "value", "ConventionValue", opaque_reader("ConventionValue.value")),
            origin=required(members, "origin", "ConventionValue", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["value"] = thaw(self.value)
        json["origin"] = self.origin.to_json()
        return json


type Conventions = Mapping[str, ConventionValue]
"""Resolved conventions, keyed by the dotted path of the convention under 'conventions' (for example 'pathVersion',
'idempotency.header'). Informative only: provenance for explain and lint. A target never acts on a convention; every
convention a target acts on is a typed member (ADR 0004 section 13).
"""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CookieScheme(Scheme):
    """A credential in a cookie; 'csrf' names the scheme that carries the CSRF token."""

    id: SchemeId
    kind: Literal["cookie"] = _dataclass_field(default="cookie", init=False)
    name: str
    """The cookie name."""
    csrf: SchemeId | None = None
    origin: Origin

    @staticmethod
    def from_json(value: object) -> CookieScheme:
        members = read_object(value, "CookieScheme")
        expect_tag(members, "kind", "cookie", "CookieScheme")
        return CookieScheme(
            id=required(members, "id", "CookieScheme", string_reader("CookieScheme.id")),
            name=required(members, "name", "CookieScheme", string_reader("CookieScheme.name")),
            csrf=optional(members, "csrf", string_reader("CookieScheme.csrf")),
            origin=required(members, "origin", "CookieScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["name"] = self.name
        if self.csrf is not None:
            json["csrf"] = self.csrf
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CredentialIdentity(Identity):
    """An identity reached through credential schemes."""

    id: IdentityId
    kind: Literal["credential"] = _dataclass_field(default="credential", init=False)
    schemes: CredentialSchemes
    principal: Principal
    errors: tuple[ErrorCode, ...]
    headers: tuple[IdentityHeaderUse, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "headers", copy_list(self.headers))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "CredentialIdentity.extensions"))

    @staticmethod
    def from_json(value: object) -> CredentialIdentity:
        members = read_object(value, "CredentialIdentity")
        expect_tag(members, "kind", "credential", "CredentialIdentity")
        return CredentialIdentity(
            id=required(members, "id", "CredentialIdentity", string_reader("CredentialIdentity.id")),
            schemes=required(members, "schemes", "CredentialIdentity", CredentialSchemes.from_json),
            principal=required(members, "principal", "CredentialIdentity", Principal.from_json),
            errors=required(
                members,
                "errors",
                "CredentialIdentity",
                list_reader("CredentialIdentity.errors", string_reader("CredentialIdentity.errors[]")),
            ),
            headers=required(
                members,
                "headers",
                "CredentialIdentity",
                list_reader("CredentialIdentity.headers", IdentityHeaderUse.from_json),
            ),
            docs=required(members, "docs", "CredentialIdentity", Docs.from_json),
            extensions=required(
                members,
                "extensions",
                "CredentialIdentity",
                extensions_reader("CredentialIdentity.extensions"),
            ),
            origin=required(members, "origin", "CredentialIdentity", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["schemes"] = self.schemes.to_json()
        json["principal"] = self.principal.to_json()
        json["errors"] = encode_list(self.errors, encode_plain)
        json["headers"] = encode_list(self.headers, encode_model)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class CredentialSchemes:
    """The schemes of a credential identity."""

    read: tuple[SchemeId, ...]
    write: tuple[SchemeId, ...]
    """Empty when the identity is refused on writes."""
    optional_read: tuple[SchemeId, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "read", copy_list(self.read))
        object.__setattr__(self, "write", copy_list(self.write))
        object.__setattr__(self, "optional_read", copy_list(self.optional_read))

    @staticmethod
    def from_json(value: object) -> CredentialSchemes:
        members = read_object(value, "CredentialSchemes")
        return CredentialSchemes(
            read=required(
                members,
                "read",
                "CredentialSchemes",
                list_reader("CredentialSchemes.read", string_reader("CredentialSchemes.read[]")),
            ),
            write=required(
                members,
                "write",
                "CredentialSchemes",
                list_reader("CredentialSchemes.write", string_reader("CredentialSchemes.write[]")),
            ),
            optional_read=required(
                members,
                "optionalRead",
                "CredentialSchemes",
                list_reader("CredentialSchemes.optionalRead", string_reader("CredentialSchemes.optionalRead[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["read"] = encode_list(self.read, encode_plain)
        json["write"] = encode_list(self.write, encode_plain)
        json["optionalRead"] = encode_list(self.optional_read, encode_plain)
        return json


type DecimalLiteral = str
"""A number written as a decimal literal string, so an int64 or decimal bound and a long multipleOf keep every digit in
every language (ADR 0003 section 8).
"""


class DeclarationKind(StrEnum):
    """A declaration kind (ADR 0004 section 2, ADR 0014)."""

    HTTP_OPERATION = "httpOperation"


@final
@dataclass(frozen=True, slots=True)
class DeclarationKindUnknown(UnknownEnumValue):
    """A value of DeclarationKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in DeclarationKind:
            raise IrModelError("DeclarationKindUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Degradable:
    paths: tuple[str, ...]
    header: str | None = None
    """The header listing degraded parts, an RFC 9110 token; required when the operation's format has no 'degraded' meta
    member (invariant ir.degradable.header).
    """
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "paths", copy_list(self.paths))

    @staticmethod
    def from_json(value: object) -> Degradable:
        members = read_object(value, "Degradable")
        return Degradable(
            paths=required(
                members,
                "paths",
                "Degradable",
                list_reader("Degradable.paths", string_reader("Degradable.paths[]")),
            ),
            header=optional(members, "header", string_reader("Degradable.header")),
            origin=required(members, "origin", "Degradable", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["paths"] = encode_list(self.paths, encode_plain)
        if self.header is not None:
            json["header"] = self.header
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Deprecation:
    since: str
    """The day the operation is deprecated, a calendar date, the Deprecation header's date (RFC 9745)."""
    sunset: str
    successor: OperationRef | None = None
    successor_rel: str | None = None
    """The Link rel of the successor, an RFC 8288 registered relation name; present if and only if 'successor' is
    (invariant ir.deprecation.headers).
    """
    origin: Origin

    @staticmethod
    def from_json(value: object) -> Deprecation:
        members = read_object(value, "Deprecation")
        return Deprecation(
            since=required(members, "since", "Deprecation", string_reader("Deprecation.since")),
            sunset=required(members, "sunset", "Deprecation", string_reader("Deprecation.sunset")),
            successor=optional(members, "successor", OperationRef.from_json),
            successor_rel=optional(members, "successorRel", string_reader("Deprecation.successorRel")),
            origin=required(members, "origin", "Deprecation", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["since"] = self.since
        json["sunset"] = self.sunset
        if self.successor is not None:
            json["successor"] = self.successor.to_json()
        if self.successor_rel is not None:
            json["successorRel"] = self.successor_rel
        json["origin"] = self.origin.to_json()
        return json


type DerivationId = str
"""A derivation id of the derivation table (ADR 0006 section 5), 'pack.<pack>.<entry>' for a pack entry."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class DerivedCsrf(Csrf):
    kind: Literal["derived"] = _dataclass_field(default="derived", init=False)
    header: str
    derived_from: DerivedFrom

    @staticmethod
    def from_json(value: object) -> DerivedCsrf:
        members = read_object(value, "DerivedCsrf")
        expect_tag(members, "kind", "derived", "DerivedCsrf")
        return DerivedCsrf(
            header=required(members, "header", "DerivedCsrf", string_reader("DerivedCsrf.header")),
            derived_from=required(members, "derivedFrom", "DerivedCsrf", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["header"] = self.header
        json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class DerivedFrom:
    """Present on, and only on, an element the compiler derived (ADR 0004 section 6)."""

    derivation: DerivationId
    from_: tuple[Origin, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "from_", copy_list(self.from_))

    @staticmethod
    def from_json(value: object) -> DerivedFrom:
        members = read_object(value, "DerivedFrom")
        return DerivedFrom(
            derivation=required(members, "derivation", "DerivedFrom", string_reader("DerivedFrom.derivation")),
            from_=required(members, "from", "DerivedFrom", list_reader("DerivedFrom.from", Origin.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["derivation"] = self.derivation
        json["from"] = encode_list(self.from_, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class DerivedIdempotency(Idempotency):
    kind: Literal["derived"] = _dataclass_field(default="derived", init=False)
    header: str
    replay_header: str
    lifetime_ms: int
    required: bool
    enforce: IdempotencyEnforcement | IdempotencyEnforcementUnknown
    derived_from: DerivedFrom

    @staticmethod
    def from_json(value: object) -> DerivedIdempotency:
        members = read_object(value, "DerivedIdempotency")
        expect_tag(members, "kind", "derived", "DerivedIdempotency")
        return DerivedIdempotency(
            header=required(members, "header", "DerivedIdempotency", string_reader("DerivedIdempotency.header")),
            replay_header=required(
                members,
                "replayHeader",
                "DerivedIdempotency",
                string_reader("DerivedIdempotency.replayHeader"),
            ),
            lifetime_ms=required(
                members,
                "lifetimeMs",
                "DerivedIdempotency",
                integer_reader("DerivedIdempotency.lifetimeMs"),
            ),
            required=required(members, "required", "DerivedIdempotency", boolean_reader("DerivedIdempotency.required")),
            enforce=required(
                members,
                "enforce",
                "DerivedIdempotency",
                open_enum_reader("DerivedIdempotency.enforce", IdempotencyEnforcement, IdempotencyEnforcementUnknown),
            ),
            derived_from=required(members, "derivedFrom", "DerivedIdempotency", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["header"] = self.header
        json["replayHeader"] = self.replay_header
        json["lifetimeMs"] = self.lifetime_ms
        json["required"] = self.required
        json["enforce"] = encode_open_enum(self.enforce)
        json["derivedFrom"] = self.derived_from.to_json()
        return json


class Direction(StrEnum):
    INPUT = "input"
    OUTPUT = "output"


@final
@dataclass(frozen=True, slots=True)
class DirectionUnknown(UnknownEnumValue):
    """A value of Direction this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in Direction:
            raise IrModelError("DirectionUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Docs:
    """Resolved documentation text."""

    summary: str | None = None
    description: str | None = None

    @staticmethod
    def from_json(value: object) -> Docs:
        members = read_object(value, "Docs")
        return Docs(
            summary=optional(members, "summary", string_reader("Docs.summary")),
            description=optional(members, "description", string_reader("Docs.description")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.summary is not None:
            json["summary"] = self.summary
        if self.description is not None:
            json["description"] = self.description
        return json


type DocumentId = str
"""The id of an api document: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class EachTemplate(Template):
    kind: Literal["each"] = _dataclass_field(default="each", init=False)
    of: Slot
    as_: Template

    @staticmethod
    def from_json(value: object) -> EachTemplate:
        members = read_object(value, "EachTemplate")
        expect_tag(members, "kind", "each", "EachTemplate")
        return EachTemplate(
            of=required(members, "of", "EachTemplate", string_reader("EachTemplate.of")),
            as_=required(members, "as", "EachTemplate", Template.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["of"] = self.of
        json["as"] = self.as_.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Enum:
    """An enum; values keep the written order (ADR 0004 section 4)."""

    id: EnumId
    name: Name
    values: tuple[str, ...]
    code_names: Mapping[str, Name] | None = None
    """Identifier override per value (ADR 0007)."""
    source: EnumSource | None = None
    local_reason: Reason | None = None
    fallback: str | None = None
    directions: tuple[Direction | DirectionUnknown, ...]
    docs: Docs
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "values", copy_list(self.values))
        if self.code_names is not None:
            object.__setattr__(self, "code_names", copy_map(self.code_names))
        object.__setattr__(self, "directions", copy_list(self.directions))

    @staticmethod
    def from_json(value: object) -> Enum:
        members = read_object(value, "Enum")
        return Enum(
            id=required(members, "id", "Enum", string_reader("Enum.id")),
            name=required(members, "name", "Enum", Name.from_json),
            values=required(members, "values", "Enum", list_reader("Enum.values", string_reader("Enum.values[]"))),
            code_names=optional(members, "codeNames", map_reader("Enum.codeNames", Name.from_json)),
            source=optional(members, "source", EnumSource.from_json),
            local_reason=optional(members, "localReason", string_reader("Enum.localReason")),
            fallback=optional(members, "fallback", string_reader("Enum.fallback")),
            directions=required(
                members,
                "directions",
                "Enum",
                list_reader("Enum.directions", open_enum_reader("Enum.directions[]", Direction, DirectionUnknown)),
            ),
            docs=required(members, "docs", "Enum", Docs.from_json),
            origin=required(members, "origin", "Enum", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["name"] = self.name.to_json()
        json["values"] = encode_list(self.values, encode_plain)
        if self.code_names is not None:
            json["codeNames"] = encode_map(self.code_names, encode_model)
        if self.source is not None:
            json["source"] = self.source.to_json()
        if self.local_reason is not None:
            json["localReason"] = self.local_reason
        if self.fallback is not None:
            json["fallback"] = self.fallback
        json["directions"] = encode_list(self.directions, encode_open_enum)
        json["docs"] = self.docs.to_json()
        json["origin"] = self.origin.to_json()
        return json


type EnumId = str
"""The id of an enum: its catalogue key, the name as written or the canonical identifier of a derived name (ADR 0004
section 9, ADR 0002 section 4).
"""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class EnumNarrowing:
    values: tuple[str, ...]
    reason: Reason | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "values", copy_list(self.values))

    @staticmethod
    def from_json(value: object) -> EnumNarrowing:
        members = read_object(value, "EnumNarrowing")
        return EnumNarrowing(
            values=required(
                members,
                "values",
                "EnumNarrowing",
                list_reader("EnumNarrowing.values", string_reader("EnumNarrowing.values[]")),
            ),
            reason=optional(members, "reason", string_reader("EnumNarrowing.reason")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["values"] = encode_list(self.values, encode_plain)
        if self.reason is not None:
            json["reason"] = self.reason
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class EnumTypeUse(TypeUse):
    kind: Literal["enum"] = _dataclass_field(default="enum", init=False)
    enum: EnumId
    narrowed_to: EnumNarrowing | None = None
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out:
    Property.nullable holds it (invariant ir.property.nullable).
    """
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""

    def __post_init__(self) -> None:
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> EnumTypeUse:
        members = read_object(value, "EnumTypeUse")
        expect_tag(members, "kind", "enum", "EnumTypeUse")
        return EnumTypeUse(
            enum=required(members, "enum", "EnumTypeUse", string_reader("EnumTypeUse.enum")),
            narrowed_to=optional(members, "narrowedTo", EnumNarrowing.from_json),
            nullable=optional(members, "nullable", boolean_reader("EnumTypeUse.nullable")),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("EnumTypeUse.examples", opaque_reader("EnumTypeUse.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["enum"] = self.enum
        if self.narrowed_to is not None:
            json["narrowedTo"] = self.narrowed_to.to_json()
        if self.nullable is not None:
            json["nullable"] = self.nullable
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


type ErrorCode = str
"""An error code, the key of the errors catalogue (ADR 0004 section 4, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ErrorDecl:
    """An error code of the registry (ADR 0004 section 4)."""

    code: ErrorCode
    family: str | None = None
    """The declared family, or the code up to its first dot."""
    nature: NatureBase | NatureBaseUnknown
    nature_name: NatureId | None = None
    http: ErrorHttp
    params: SchemaRef | None = None
    example: FrozenJson | Omitted = OMITTED
    title: str | None = None
    docs: Docs
    origin: Origin
    default: ErrorRole | ErrorRoleUnknown | None = None
    no_store: bool | None = None
    """Every response of this code carries Cache-Control: no-store, since its params reach a sensitive value (ADR 0003
    section 6, conventions.cache.sensitiveElsewhere: noStore); absent means false (invariant
    ir.error.sensitive-no-store).
    """

    def __post_init__(self) -> None:
        if not isinstance(self.example, Omitted):
            object.__setattr__(self, "example", freeze(self.example, "ErrorDecl.example"))

    @staticmethod
    def from_json(value: object) -> ErrorDecl:
        members = read_object(value, "ErrorDecl")
        return ErrorDecl(
            code=required(members, "code", "ErrorDecl", string_reader("ErrorDecl.code")),
            family=optional(members, "family", string_reader("ErrorDecl.family")),
            nature=required(
                members,
                "nature",
                "ErrorDecl",
                open_enum_reader("ErrorDecl.nature", NatureBase, NatureBaseUnknown),
            ),
            nature_name=optional(members, "natureName", string_reader("ErrorDecl.natureName")),
            http=required(members, "http", "ErrorDecl", ErrorHttp.from_json),
            params=optional(members, "params", string_reader("ErrorDecl.params")),
            example=optional_opaque(members, "example", "ErrorDecl.example"),
            title=optional(members, "title", string_reader("ErrorDecl.title")),
            docs=required(members, "docs", "ErrorDecl", Docs.from_json),
            origin=required(members, "origin", "ErrorDecl", Origin.from_json),
            default=optional(members, "default", open_enum_reader("ErrorDecl.default", ErrorRole, ErrorRoleUnknown)),
            no_store=optional(members, "noStore", boolean_reader("ErrorDecl.noStore")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["code"] = self.code
        if self.family is not None:
            json["family"] = self.family
        json["nature"] = encode_open_enum(self.nature)
        if self.nature_name is not None:
            json["natureName"] = self.nature_name
        json["http"] = self.http.to_json()
        if self.params is not None:
            json["params"] = self.params
        if not isinstance(self.example, Omitted):
            json["example"] = thaw(self.example)
        if self.title is not None:
            json["title"] = self.title
        json["docs"] = self.docs.to_json()
        json["origin"] = self.origin.to_json()
        if self.default is not None:
            json["default"] = encode_open_enum(self.default)
        if self.no_store is not None:
            json["noStore"] = self.no_store
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ErrorHttp:
    """The HTTP attributes of an error code (ADR 0014)."""

    status: int

    @staticmethod
    def from_json(value: object) -> ErrorHttp:
        members = read_object(value, "ErrorHttp")
        return ErrorHttp(status=required(members, "status", "ErrorHttp", integer_reader("ErrorHttp.status")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["status"] = self.status
        return json


class ErrorRole(StrEnum):
    """A role of ADR 0006 section 6."""

    SCHEMA_INVALID = "schemaInvalid"
    PAYLOAD_TOO_LARGE = "payloadTooLarge"
    UNSUPPORTED_MEDIA_TYPE = "unsupportedMediaType"
    UNAUTHENTICATED = "unauthenticated"
    CSRF_INVALID = "csrfInvalid"
    IDEMPOTENCY_KEY_REUSED = "idempotencyKeyReused"
    IDEMPOTENCY_IN_PROGRESS = "idempotencyInProgress"
    STATE_CONFLICT = "stateConflict"
    PRECONDITION_FAILED = "preconditionFailed"
    PRECONDITION_REQUIRED = "preconditionRequired"
    NOT_FOUND = "notFound"
    FORBIDDEN = "forbidden"
    SORT_KEY_FORBIDDEN = "sortKeyForbidden"
    RATE_LIMITED = "rateLimited"
    DEADLINE_EXCEEDED = "deadlineExceeded"
    GONE = "gone"
    UPSTREAM_UNAVAILABLE = "upstreamUnavailable"
    SERVICE_UNAVAILABLE = "serviceUnavailable"
    UPSTREAM_TIMEOUT = "upstreamTimeout"
    UNDECLARED_STATUS = "undeclaredStatus"


@final
@dataclass(frozen=True, slots=True)
class ErrorRoleUnknown(UnknownEnumValue):
    """A value of ErrorRole this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ErrorRole:
            raise IrModelError("ErrorRoleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ErrorRoleBinding:
    """A role this code answers on the operation and the template filling its params from the role's data (ADR 0006
    section 6).
    """

    role: ErrorRole | ErrorRoleUnknown
    params: Template | None = None
    """Present if and only if the code declares params (invariant ir.error.role-params)."""

    @staticmethod
    def from_json(value: object) -> ErrorRoleBinding:
        members = read_object(value, "ErrorRoleBinding")
        return ErrorRoleBinding(
            role=required(
                members,
                "role",
                "ErrorRoleBinding",
                open_enum_reader("ErrorRoleBinding.role", ErrorRole, ErrorRoleUnknown),
            ),
            params=optional(members, "params", Template.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["role"] = encode_open_enum(self.role)
        if self.params is not None:
            json["params"] = self.params.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ErrorShape:
    media: str
    body: Template
    headers: tuple[HeaderTemplate, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", copy_list(self.headers))

    @staticmethod
    def from_json(value: object) -> ErrorShape:
        members = read_object(value, "ErrorShape")
        return ErrorShape(
            media=required(members, "media", "ErrorShape", string_reader("ErrorShape.media")),
            body=required(members, "body", "ErrorShape", Template.from_json),
            headers=required(
                members,
                "headers",
                "ErrorShape",
                list_reader("ErrorShape.headers", HeaderTemplate.from_json),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["media"] = self.media
        json["body"] = self.body.to_json()
        json["headers"] = encode_list(self.headers, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ExemptCsrf(Csrf):
    kind: Literal["exempt"] = _dataclass_field(default="exempt", init=False)
    reason: Reason
    origin: Origin

    @staticmethod
    def from_json(value: object) -> ExemptCsrf:
        members = read_object(value, "ExemptCsrf")
        expect_tag(members, "kind", "exempt", "ExemptCsrf")
        return ExemptCsrf(
            reason=required(members, "reason", "ExemptCsrf", string_reader("ExemptCsrf.reason")),
            origin=required(members, "origin", "ExemptCsrf", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ExemptIdempotency(Idempotency):
    kind: Literal["exempt"] = _dataclass_field(default="exempt", init=False)
    reason: Reason
    origin: Origin

    @staticmethod
    def from_json(value: object) -> ExemptIdempotency:
        members = read_object(value, "ExemptIdempotency")
        expect_tag(members, "kind", "exempt", "ExemptIdempotency")
        return ExemptIdempotency(
            reason=required(members, "reason", "ExemptIdempotency", string_reader("ExemptIdempotency.reason")),
            origin=required(members, "origin", "ExemptIdempotency", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        return json


type ExtensionKey = str
"""An extension key under its prefix (ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ExtensionKeyDecl:
    """A declared extension key (ADR 0002 section 12)."""

    id: ExtensionKeyId
    prefix: ExtensionPrefix
    key: ExtensionKey
    schema: TypeUse
    places: tuple[ExtensionPlace | ExtensionPlaceUnknown, ...]
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "places", copy_list(self.places))

    @staticmethod
    def from_json(value: object) -> ExtensionKeyDecl:
        members = read_object(value, "ExtensionKeyDecl")
        return ExtensionKeyDecl(
            id=required(members, "id", "ExtensionKeyDecl", string_reader("ExtensionKeyDecl.id")),
            prefix=required(members, "prefix", "ExtensionKeyDecl", string_reader("ExtensionKeyDecl.prefix")),
            key=required(members, "key", "ExtensionKeyDecl", string_reader("ExtensionKeyDecl.key")),
            schema=required(members, "schema", "ExtensionKeyDecl", TypeUse.from_json),
            places=required(
                members,
                "places",
                "ExtensionKeyDecl",
                list_reader(
                    "ExtensionKeyDecl.places",
                    open_enum_reader("ExtensionKeyDecl.places[]", ExtensionPlace, ExtensionPlaceUnknown),
                ),
            ),
            origin=required(members, "origin", "ExtensionKeyDecl", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["prefix"] = self.prefix
        json["key"] = self.key
        json["schema"] = self.schema.to_json()
        json["places"] = encode_list(self.places, encode_open_enum)
        json["origin"] = self.origin.to_json()
        return json


type ExtensionKeyId = str
"""A declared extension key, written '<prefix>-<key>' (ADR 0002 sections 4 and 12)."""


class ExtensionPlace(StrEnum):
    """Where an extension key may appear (ADR 0002 section 12)."""

    API = "api"
    OPERATION = "operation"
    SCHEMA = "schema"
    PROPERTY = "property"
    RIGHT = "right"
    RULE = "rule"
    SCOPE = "scope"


@final
@dataclass(frozen=True, slots=True)
class ExtensionPlaceUnknown(UnknownEnumValue):
    """A value of ExtensionPlace this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ExtensionPlace:
            raise IrModelError("ExtensionPlaceUnknown: the value is a known one")


type ExtensionPrefix = str
"""An extension prefix (ADR 0002 section 4); the compiler refuses 'seampact', which is reserved."""


type Extensions = Mapping[str, Mapping[str, FrozenJson]]
"""The extension slot: { '<prefix>': { '<key>': value } } (ADR 0004 section 3)."""


type Feature = str
"""A must-understand feature name (ADR 0005 section 3); none is defined at irRevision 2."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class FieldRestriction:
    """A restrictedTo mark (ADR 0003 section 6)."""

    right: RightId
    params: FrozenJson | Omitted = OMITTED
    input_policy: InputPolicy | InputPolicyUnknown | None = None
    origin: Origin | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.params, Omitted):
            object.__setattr__(self, "params", freeze(self.params, "FieldRestriction.params"))

    @staticmethod
    def from_json(value: object) -> FieldRestriction:
        members = read_object(value, "FieldRestriction")
        return FieldRestriction(
            right=required(members, "right", "FieldRestriction", string_reader("FieldRestriction.right")),
            params=optional_opaque(members, "params", "FieldRestriction.params"),
            input_policy=optional(
                members,
                "inputPolicy",
                open_enum_reader("FieldRestriction.inputPolicy", InputPolicy, InputPolicyUnknown),
            ),
            origin=optional(members, "origin", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["right"] = self.right
        if not isinstance(self.params, Omitted):
            json["params"] = thaw(self.params)
        if self.input_policy is not None:
            json["inputPolicy"] = encode_open_enum(self.input_policy)
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class FieldRight:
    """A field right, materialised so targets never walk schemas (FR-23)."""

    schema: SchemaId
    pointer: str
    right: RightId
    params: FrozenJson | Omitted = OMITTED
    subject: FieldRightSubject | None = None
    direction: Direction | DirectionUnknown
    input_policy: InputPolicy | InputPolicyUnknown | None = None
    always: FieldRightAlways | FieldRightAlwaysUnknown | None = None
    derived_from: DerivedFrom

    def __post_init__(self) -> None:
        if not isinstance(self.params, Omitted):
            object.__setattr__(self, "params", freeze(self.params, "FieldRight.params"))

    @staticmethod
    def from_json(value: object) -> FieldRight:
        members = read_object(value, "FieldRight")
        return FieldRight(
            schema=required(members, "schema", "FieldRight", string_reader("FieldRight.schema")),
            pointer=required(members, "pointer", "FieldRight", string_reader("FieldRight.pointer")),
            right=required(members, "right", "FieldRight", string_reader("FieldRight.right")),
            params=optional_opaque(members, "params", "FieldRight.params"),
            subject=optional(members, "subject", FieldRightSubject.from_json),
            direction=required(
                members,
                "direction",
                "FieldRight",
                open_enum_reader("FieldRight.direction", Direction, DirectionUnknown),
            ),
            input_policy=optional(
                members,
                "inputPolicy",
                open_enum_reader("FieldRight.inputPolicy", InputPolicy, InputPolicyUnknown),
            ),
            always=optional(
                members,
                "always",
                open_enum_reader("FieldRight.always", FieldRightAlways, FieldRightAlwaysUnknown),
            ),
            derived_from=required(members, "derivedFrom", "FieldRight", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["schema"] = self.schema
        json["pointer"] = self.pointer
        json["right"] = self.right
        if not isinstance(self.params, Omitted):
            json["params"] = thaw(self.params)
        if self.subject is not None:
            json["subject"] = self.subject.to_json()
        json["direction"] = encode_open_enum(self.direction)
        if self.input_policy is not None:
            json["inputPolicy"] = encode_open_enum(self.input_policy)
        if self.always is not None:
            json["always"] = encode_open_enum(self.always)
        json["derivedFrom"] = self.derived_from.to_json()
        return json


class FieldRightAlways(StrEnum):
    """An outcome that needs no decide call: 'absent', the field is never sent on this operation (ADR 0003 section 6).
    Must act: an unknown value makes the IR invalid for every reader.
    """

    ABSENT = "absent"


@final
@dataclass(frozen=True, slots=True)
class FieldRightAlwaysUnknown(UnknownEnumValue):
    """A value of FieldRightAlways this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in FieldRightAlways:
            raise IrModelError("FieldRightAlwaysUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class FieldRightSubject:
    source: ValueSource
    """Where the subject is read; 'in: holderField' names the holder's property on output."""

    @staticmethod
    def from_json(value: object) -> FieldRightSubject:
        members = read_object(value, "FieldRightSubject")
        return FieldRightSubject(source=required(members, "source", "FieldRightSubject", ValueSource.from_json))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["source"] = self.source.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class FieldWire:
    """The wire form of a form or multipart field: a query wire kind with style, explode and brackets, or kind 'file' or
    'json' alone (invariant ir.field-wire.members).
    """

    kind: FieldWireKind | FieldWireKindUnknown
    style: QueryStyle | QueryStyleUnknown | None = None
    explode: bool | None = None
    brackets: bool | None = None

    @staticmethod
    def from_json(value: object) -> FieldWire:
        members = read_object(value, "FieldWire")
        return FieldWire(
            kind=required(
                members,
                "kind",
                "FieldWire",
                open_enum_reader("FieldWire.kind", FieldWireKind, FieldWireKindUnknown),
            ),
            style=optional(members, "style", open_enum_reader("FieldWire.style", QueryStyle, QueryStyleUnknown)),
            explode=optional(members, "explode", boolean_reader("FieldWire.explode")),
            brackets=optional(members, "brackets", boolean_reader("FieldWire.brackets")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = encode_open_enum(self.kind)
        if self.style is not None:
            json["style"] = encode_open_enum(self.style)
        if self.explode is not None:
            json["explode"] = self.explode
        if self.brackets is not None:
            json["brackets"] = self.brackets
        return json


class FieldWireKind(StrEnum):
    """How a form or multipart field is written: a query wire kind, 'file' or 'json'."""

    NUMBER = "number"
    BOOLEAN = "boolean"
    LIST = "list"
    TEXT = "text"
    OBJECT = "object"
    FILE = "file"
    JSON = "json"


@final
@dataclass(frozen=True, slots=True)
class FieldWireKindUnknown(UnknownEnumValue):
    """A value of FieldWireKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in FieldWireKind:
            raise IrModelError("FieldWireKindUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class FileTypeUse(TypeUse):
    """A multipart field or a download (A39)."""

    kind: Literal["file"] = _dataclass_field(default="file", init=False)
    media: tuple[str, ...]
    max_size_bytes: int | None = None
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out:
    Property.nullable holds it (invariant ir.property.nullable).
    """
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "media", copy_list(self.media))
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> FileTypeUse:
        members = read_object(value, "FileTypeUse")
        expect_tag(members, "kind", "file", "FileTypeUse")
        return FileTypeUse(
            media=required(
                members,
                "media",
                "FileTypeUse",
                list_reader("FileTypeUse.media", string_reader("FileTypeUse.media[]")),
            ),
            max_size_bytes=optional(members, "maxSizeBytes", integer_reader("FileTypeUse.maxSizeBytes")),
            nullable=optional(members, "nullable", boolean_reader("FileTypeUse.nullable")),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("FileTypeUse.examples", opaque_reader("FileTypeUse.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["media"] = encode_list(self.media, encode_plain)
        if self.max_size_bytes is not None:
            json["maxSizeBytes"] = self.max_size_bytes
        if self.nullable is not None:
            json["nullable"] = self.nullable
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


type FormatId = str
"""The id of a wire format: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


class HandlerResultMember(StrEnum):
    """What a handler returns beside a page's items."""

    NEXT_CURSOR = "nextCursor"
    PREVIOUS_CURSOR = "previousCursor"
    TOTAL = "total"
    MORE = "more"
    NEXT_SINCE = "nextSince"
    COMPLETE = "complete"


@final
@dataclass(frozen=True, slots=True)
class HandlerResultMemberUnknown(UnknownEnumValue):
    """A value of HandlerResultMember this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in HandlerResultMember:
            raise IrModelError("HandlerResultMemberUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class HeaderDecl:
    """An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and
    'request' for versionToken (invariant ir.header.members).
    """

    id: HeaderId
    semantic: HeaderSemantic | HeaderSemanticUnknown
    name: str | None = None
    in_: HeaderSide | HeaderSideUnknown | None = None
    response: str | None = None
    request: str | None = None
    schema: TypeUse | None = None
    origin: Origin

    @staticmethod
    def from_json(value: object) -> HeaderDecl:
        members = read_object(value, "HeaderDecl")
        return HeaderDecl(
            id=required(members, "id", "HeaderDecl", string_reader("HeaderDecl.id")),
            semantic=required(
                members,
                "semantic",
                "HeaderDecl",
                open_enum_reader("HeaderDecl.semantic", HeaderSemantic, HeaderSemanticUnknown),
            ),
            name=optional(members, "name", string_reader("HeaderDecl.name")),
            in_=optional(members, "in", open_enum_reader("HeaderDecl.in", HeaderSide, HeaderSideUnknown)),
            response=optional(members, "response", string_reader("HeaderDecl.response")),
            request=optional(members, "request", string_reader("HeaderDecl.request")),
            schema=optional(members, "schema", TypeUse.from_json),
            origin=required(members, "origin", "HeaderDecl", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["semantic"] = encode_open_enum(self.semantic)
        if self.name is not None:
            json["name"] = self.name
        if self.in_ is not None:
            json["in"] = encode_open_enum(self.in_)
        if self.response is not None:
            json["response"] = self.response
        if self.request is not None:
            json["request"] = self.request
        if self.schema is not None:
            json["schema"] = self.schema.to_json()
        json["origin"] = self.origin.to_json()
        return json


type HeaderId = str
"""The id of an identity header: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class HeaderScheme(Scheme):
    """A credential in a request header."""

    id: SchemeId
    kind: Literal["header"] = _dataclass_field(default="header", init=False)
    name: str
    """The header name."""
    origin: Origin

    @staticmethod
    def from_json(value: object) -> HeaderScheme:
        members = read_object(value, "HeaderScheme")
        expect_tag(members, "kind", "header", "HeaderScheme")
        return HeaderScheme(
            id=required(members, "id", "HeaderScheme", string_reader("HeaderScheme.id")),
            name=required(members, "name", "HeaderScheme", string_reader("HeaderScheme.name")),
            origin=required(members, "origin", "HeaderScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["name"] = self.name
        json["origin"] = self.origin.to_json()
        return json


class HeaderSemantic(StrEnum):
    """What an identity header carries (ADR 0002 section 9)."""

    DEADLINE = "deadline"
    TRACE_CONTEXT = "traceContext"
    ACTOR_SURFACE = "actorSurface"
    VERSION_TOKEN = "versionToken"


@final
@dataclass(frozen=True, slots=True)
class HeaderSemanticUnknown(UnknownEnumValue):
    """A value of HeaderSemantic this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in HeaderSemantic:
            raise IrModelError("HeaderSemanticUnknown: the value is a known one")


class HeaderSide(StrEnum):
    """The message a header travels in."""

    REQUEST = "request"
    RESPONSE = "response"


@final
@dataclass(frozen=True, slots=True)
class HeaderSideUnknown(UnknownEnumValue):
    """A value of HeaderSide this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in HeaderSide:
            raise IrModelError("HeaderSideUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class HeaderTemplate:
    name: str
    value: Template

    @staticmethod
    def from_json(value: object) -> HeaderTemplate:
        members = read_object(value, "HeaderTemplate")
        return HeaderTemplate(
            name=required(members, "name", "HeaderTemplate", string_reader("HeaderTemplate.name")),
            value=required(members, "value", "HeaderTemplate", Template.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["value"] = self.value.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class HeaderUnionTag(UnionTag):
    in_: Literal["header"] = _dataclass_field(default="header", init=False)
    name: str

    @staticmethod
    def from_json(value: object) -> HeaderUnionTag:
        members = read_object(value, "HeaderUnionTag")
        expect_tag(members, "in", "header", "HeaderUnionTag")
        return HeaderUnionTag(name=required(members, "name", "HeaderUnionTag", string_reader("HeaderUnionTag.name")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["in"] = self.in_
        json["name"] = self.name
        return json


class HeaderUseFor(StrEnum):
    """The operations an identity header applies to."""

    ALL = "all"
    READS = "reads"
    WRITES = "writes"


@final
@dataclass(frozen=True, slots=True)
class HeaderUseForUnknown(UnknownEnumValue):
    """A value of HeaderUseFor this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in HeaderUseFor:
            raise IrModelError("HeaderUseForUnknown: the value is a known one")


class HttpMethod(StrEnum):
    GET = "get"
    POST = "post"
    PUT = "put"
    PATCH = "patch"
    DELETE = "delete"


@final
@dataclass(frozen=True, slots=True)
class HttpMethodUnknown(UnknownEnumValue):
    """A value of HttpMethod this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in HttpMethod:
            raise IrModelError("HttpMethodUnknown: the value is a known one")


class IdempotencyEnforcement(StrEnum):
    """Where the idempotency key is enforced."""

    BOUNDARY = "boundary"
    NONE = "none"


@final
@dataclass(frozen=True, slots=True)
class IdempotencyEnforcementUnknown(UnknownEnumValue):
    """A value of IdempotencyEnforcement this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in IdempotencyEnforcement:
            raise IrModelError("IdempotencyEnforcementUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IdentityAccess(Access):
    kind: Literal["identity"] = _dataclass_field(default="identity", init=False)
    identity: IdentityId
    schemes: tuple[SchemeId, ...]
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "schemes", copy_list(self.schemes))

    @staticmethod
    def from_json(value: object) -> IdentityAccess:
        members = read_object(value, "IdentityAccess")
        expect_tag(members, "kind", "identity", "IdentityAccess")
        return IdentityAccess(
            identity=required(members, "identity", "IdentityAccess", string_reader("IdentityAccess.identity")),
            schemes=required(
                members,
                "schemes",
                "IdentityAccess",
                list_reader("IdentityAccess.schemes", string_reader("IdentityAccess.schemes[]")),
            ),
            origin=required(members, "origin", "IdentityAccess", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["identity"] = self.identity
        json["schemes"] = encode_list(self.schemes, encode_plain)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IdentityHeaderUse:
    """A use of the headers catalogue by an identity."""

    header: HeaderId
    for_: HeaderUseFor | HeaderUseForUnknown
    required: bool
    schema: TypeUse | None = None
    from_: ValueSource | None = None
    stale: ErrorCode | None = None
    origin: Origin

    @staticmethod
    def from_json(value: object) -> IdentityHeaderUse:
        members = read_object(value, "IdentityHeaderUse")
        return IdentityHeaderUse(
            header=required(members, "header", "IdentityHeaderUse", string_reader("IdentityHeaderUse.header")),
            for_=required(
                members,
                "for",
                "IdentityHeaderUse",
                open_enum_reader("IdentityHeaderUse.for", HeaderUseFor, HeaderUseForUnknown),
            ),
            required=required(members, "required", "IdentityHeaderUse", boolean_reader("IdentityHeaderUse.required")),
            schema=optional(members, "schema", TypeUse.from_json),
            from_=optional(members, "from", ValueSource.from_json),
            stale=optional(members, "stale", string_reader("IdentityHeaderUse.stale")),
            origin=required(members, "origin", "IdentityHeaderUse", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["header"] = self.header
        json["for"] = encode_open_enum(self.for_)
        json["required"] = self.required
        if self.schema is not None:
            json["schema"] = self.schema.to_json()
        if self.from_ is not None:
            json["from"] = self.from_.to_json()
        if self.stale is not None:
            json["stale"] = self.stale
        json["origin"] = self.origin.to_json()
        return json


type IdentityId = str
"""The id of an identity: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IgnoreKeysPolicy(KeysPolicy):
    policy: Literal["ignore"] = _dataclass_field(default="ignore", init=False)
    reason: Reason

    @staticmethod
    def from_json(value: object) -> IgnoreKeysPolicy:
        members = read_object(value, "IgnoreKeysPolicy")
        expect_tag(members, "policy", "ignore", "IgnoreKeysPolicy")
        return IgnoreKeysPolicy(
            reason=required(members, "reason", "IgnoreKeysPolicy", string_reader("IgnoreKeysPolicy.reason")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = self.policy
        json["reason"] = self.reason
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class IgnoreUnknownQuery(UnknownQuery):
    policy: Literal["ignore"] = _dataclass_field(default="ignore", init=False)
    reason: Reason
    origin: Origin

    @staticmethod
    def from_json(value: object) -> IgnoreUnknownQuery:
        members = read_object(value, "IgnoreUnknownQuery")
        expect_tag(members, "policy", "ignore", "IgnoreUnknownQuery")
        return IgnoreUnknownQuery(
            reason=required(members, "reason", "IgnoreUnknownQuery", string_reader("IgnoreUnknownQuery.reason")),
            origin=required(members, "origin", "IgnoreUnknownQuery", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = self.policy
        json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class InputField:
    name: str
    wire: FieldWire

    @staticmethod
    def from_json(value: object) -> InputField:
        members = read_object(value, "InputField")
        return InputField(
            name=required(members, "name", "InputField", string_reader("InputField.name")),
            wire=required(members, "wire", "InputField", FieldWire.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["wire"] = self.wire.to_json()
        return json


class InputMediaType(StrEnum):
    """The media type of a request body."""

    APPLICATION_JSON = "application/json"
    APPLICATION_X_WWW_FORM_URLENCODED = "application/x-www-form-urlencoded"
    MULTIPART_FORM_DATA = "multipart/form-data"


@final
@dataclass(frozen=True, slots=True)
class InputMediaTypeUnknown(UnknownEnumValue):
    """A value of InputMediaType this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in InputMediaType:
            raise IrModelError("InputMediaTypeUnknown: the value is a known one")


class InputPolicy(StrEnum):
    """What the boundary does with a restricted input field sent without the right (A21). Must act: an unknown value
    makes the IR invalid for every reader.
    """

    REJECT = "reject"
    STRIP = "strip"


@final
@dataclass(frozen=True, slots=True)
class InputPolicyUnknown(UnknownEnumValue):
    """A value of InputPolicy this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in InputPolicy:
            raise IrModelError("InputPolicyUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class InputProof:
    """A body field the compiler adds to the input for a rule proof read in the body (derivation 'rule.proof'): required
    and sensitive (ADR 0002 section 9). A proof read in a header is a derived header parameter.
    """

    name: str
    schema: TypeUse
    wire: FieldWire | None = None
    """The proof's wire form, as an input field's: present exactly when the input's media is form or multipart, and
    never of kind 'file' (invariant ir.input-proof.wire).
    """
    derived_from: DerivedFrom

    @staticmethod
    def from_json(value: object) -> InputProof:
        members = read_object(value, "InputProof")
        return InputProof(
            name=required(members, "name", "InputProof", string_reader("InputProof.name")),
            schema=required(members, "schema", "InputProof", TypeUse.from_json),
            wire=optional(members, "wire", FieldWire.from_json),
            derived_from=required(members, "derivedFrom", "InputProof", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["schema"] = self.schema.to_json()
        if self.wire is not None:
            json["wire"] = self.wire.to_json()
        json["derivedFrom"] = self.derived_from.to_json()
        return json


class Int64Wire(StrEnum):
    """How an int64 value is sent: its string form, or a JSON number."""

    STRING = "string"
    NUMBER = "number"


@final
@dataclass(frozen=True, slots=True)
class Int64WireUnknown(UnknownEnumValue):
    """A value of Int64Wire this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in Int64Wire:
            raise IrModelError("Int64WireUnknown: the value is a known one")


class InternalPolicy(StrEnum):
    """Whether a document lists internal operations."""

    INCLUDE = "include"
    EXCLUDE = "exclude"


@final
@dataclass(frozen=True, slots=True)
class InternalPolicyUnknown(UnknownEnumValue):
    """A value of InternalPolicy this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in InternalPolicy:
            raise IrModelError("InternalPolicyUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class JsonContent:
    """A form or multipart text field holding JSON."""

    media: JsonMediaType | JsonMediaTypeUnknown
    schema: TypeUse

    @staticmethod
    def from_json(value: object) -> JsonContent:
        members = read_object(value, "JsonContent")
        return JsonContent(
            media=required(
                members,
                "media",
                "JsonContent",
                open_enum_reader("JsonContent.media", JsonMediaType, JsonMediaTypeUnknown),
            ),
            schema=required(members, "schema", "JsonContent", TypeUse.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["media"] = encode_open_enum(self.media)
        json["schema"] = self.schema.to_json()
        return json


class JsonMediaType(StrEnum):
    """The media type of a JSON text field."""

    APPLICATION_JSON = "application/json"


@final
@dataclass(frozen=True, slots=True)
class JsonMediaTypeUnknown(UnknownEnumValue):
    """A value of JsonMediaType this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in JsonMediaType:
            raise IrModelError("JsonMediaTypeUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class KeepKeysPolicy(KeysPolicy):
    policy: Literal["keep"] = _dataclass_field(default="keep", init=False)
    reason: Reason

    @staticmethod
    def from_json(value: object) -> KeepKeysPolicy:
        members = read_object(value, "KeepKeysPolicy")
        expect_tag(members, "policy", "keep", "KeepKeysPolicy")
        return KeepKeysPolicy(
            reason=required(members, "reason", "KeepKeysPolicy", string_reader("KeepKeysPolicy.reason")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = self.policy
        json["reason"] = self.reason
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class LabelApiVersion(ApiVersion):
    kind: Literal["label"] = _dataclass_field(default="label", init=False)
    label: str

    @staticmethod
    def from_json(value: object) -> LabelApiVersion:
        members = read_object(value, "LabelApiVersion")
        expect_tag(members, "kind", "label", "LabelApiVersion")
        return LabelApiVersion(
            label=required(members, "label", "LabelApiVersion", string_reader("LabelApiVersion.label")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["label"] = self.label
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Lint:
    rules: Mapping[str, LintRule]
    allows: tuple[LintAllow, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "rules", copy_map(self.rules))
        object.__setattr__(self, "allows", copy_list(self.allows))

    @staticmethod
    def from_json(value: object) -> Lint:
        members = read_object(value, "Lint")
        return Lint(
            rules=required(members, "rules", "Lint", map_reader("Lint.rules", LintRule.from_json)),
            allows=required(members, "allows", "Lint", list_reader("Lint.allows", LintAllow.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["rules"] = encode_map(self.rules, encode_model)
        json["allows"] = encode_list(self.allows, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class LintAllow:
    """An allow of ADR 0002 section 12."""

    rule: str
    at: Origin
    reason: Reason
    subtree: bool

    @staticmethod
    def from_json(value: object) -> LintAllow:
        members = read_object(value, "LintAllow")
        return LintAllow(
            rule=required(members, "rule", "LintAllow", string_reader("LintAllow.rule")),
            at=required(members, "at", "LintAllow", Origin.from_json),
            reason=required(members, "reason", "LintAllow", string_reader("LintAllow.reason")),
            subtree=required(members, "subtree", "LintAllow", boolean_reader("LintAllow.subtree")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["rule"] = self.rule
        json["at"] = self.at.to_json()
        json["reason"] = self.reason
        json["subtree"] = self.subtree
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class LintRule:
    """A resolved lint severity."""

    severity: LintSeverity | LintSeverityUnknown
    origin: Origin

    @staticmethod
    def from_json(value: object) -> LintRule:
        members = read_object(value, "LintRule")
        return LintRule(
            severity=required(
                members,
                "severity",
                "LintRule",
                open_enum_reader("LintRule.severity", LintSeverity, LintSeverityUnknown),
            ),
            origin=required(members, "origin", "LintRule", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["severity"] = encode_open_enum(self.severity)
        json["origin"] = self.origin.to_json()
        return json


class LintSeverity(StrEnum):
    """A lint severity."""

    DISABLED = "disabled"
    WARNING = "warning"
    ERROR = "error"


@final
@dataclass(frozen=True, slots=True)
class LintSeverityUnknown(UnknownEnumValue):
    """A value of LintSeverity this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in LintSeverity:
            raise IrModelError("LintSeverityUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class LiteralTemplate(Template):
    kind: Literal["literal"] = _dataclass_field(default="literal", init=False)
    value: FrozenJson

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", freeze(self.value, "LiteralTemplate.value"))

    @staticmethod
    def from_json(value: object) -> LiteralTemplate:
        members = read_object(value, "LiteralTemplate")
        expect_tag(members, "kind", "literal", "LiteralTemplate")
        return LiteralTemplate(
            value=required(members, "value", "LiteralTemplate", opaque_reader("LiteralTemplate.value")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["value"] = thaw(self.value)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class MapSchema(Schema):
    kind: Literal["map"] = _dataclass_field(default="map", init=False)
    keys: TypeUse | None = None
    values: TypeUse
    id: SchemaId
    name: Name
    type_name: str | None = None
    directions: tuple[Direction | DirectionUnknown, ...]
    examples: tuple[FrozenJson, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin
    deprecated: bool | None = None
    """The schema is deprecated (ADR 0003 section 1); absent means false."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "directions", copy_list(self.directions))
        object.__setattr__(self, "examples", copy_list(self.examples))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "MapSchema.extensions"))

    @staticmethod
    def from_json(value: object) -> MapSchema:
        members = read_object(value, "MapSchema")
        expect_tag(members, "kind", "map", "MapSchema")
        return MapSchema(
            keys=optional(members, "keys", TypeUse.from_json),
            values=required(members, "values", "MapSchema", TypeUse.from_json),
            id=required(members, "id", "MapSchema", string_reader("MapSchema.id")),
            name=required(members, "name", "MapSchema", Name.from_json),
            type_name=optional(members, "typeName", string_reader("MapSchema.typeName")),
            directions=required(
                members,
                "directions",
                "MapSchema",
                list_reader(
                    "MapSchema.directions",
                    open_enum_reader("MapSchema.directions[]", Direction, DirectionUnknown),
                ),
            ),
            examples=required(
                members,
                "examples",
                "MapSchema",
                list_reader("MapSchema.examples", opaque_reader("MapSchema.examples[]")),
            ),
            docs=required(members, "docs", "MapSchema", Docs.from_json),
            extensions=required(members, "extensions", "MapSchema", extensions_reader("MapSchema.extensions")),
            origin=required(members, "origin", "MapSchema", Origin.from_json),
            deprecated=optional(members, "deprecated", boolean_reader("MapSchema.deprecated")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        if self.keys is not None:
            json["keys"] = self.keys.to_json()
        json["values"] = self.values.to_json()
        json["id"] = self.id
        json["name"] = self.name.to_json()
        if self.type_name is not None:
            json["typeName"] = self.type_name
        json["directions"] = encode_list(self.directions, encode_open_enum)
        json["examples"] = encode_list(self.examples, thaw)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        if self.deprecated is not None:
            json["deprecated"] = self.deprecated
        return json


class Maturity(StrEnum):
    EXPERIMENTAL = "experimental"
    PROVISIONAL = "provisional"
    STABLE = "stable"


@final
@dataclass(frozen=True, slots=True)
class MaturityUnknown(UnknownEnumValue):
    """A value of Maturity this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in Maturity:
            raise IrModelError("MaturityUnknown: the value is a known one")


class MaturitySource(StrEnum):
    """Where an operation's maturity comes from."""

    API = "api"
    UPSTREAM = "upstream"
    STATED = "stated"


@final
@dataclass(frozen=True, slots=True)
class MaturitySourceUnknown(UnknownEnumValue):
    """A value of MaturitySource this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in MaturitySource:
            raise IrModelError("MaturitySourceUnknown: the value is a known one")


class MetaFill(StrEnum):
    """Who fills a $meta member; 'source' reads the member 'source'."""

    NOW = "now"
    TRACE_ID = "traceId"
    DEGRADED = "degraded"
    HANDLER = "handler"
    SOURCE = "source"


@final
@dataclass(frozen=True, slots=True)
class MetaFillUnknown(UnknownEnumValue):
    """A value of MetaFill this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in MetaFill:
            raise IrModelError("MetaFillUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class MetaMember:
    """A member of the format's $meta: 'source' set if and only if 'fill' is 'source' (invariant ir.meta.source)."""

    type: TypeUse
    fill: MetaFill | MetaFillUnknown
    source: ValueSource | None = None

    @staticmethod
    def from_json(value: object) -> MetaMember:
        members = read_object(value, "MetaMember")
        return MetaMember(
            type=required(members, "type", "MetaMember", TypeUse.from_json),
            fill=required(
                members,
                "fill",
                "MetaMember",
                open_enum_reader("MetaMember.fill", MetaFill, MetaFillUnknown),
            ),
            source=optional(members, "source", ValueSource.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["type"] = self.type.to_json()
        json["fill"] = encode_open_enum(self.fill)
        if self.source is not None:
            json["source"] = self.source.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Name:
    """A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1 and its amendment)."""

    segments: tuple[str, ...]
    role: NameRole | NameRoleUnknown
    status: int | None = None
    """The HTTP success or redirect status of a 'response' name; present if and only if role is 'response' (invariant
    ir.name.status, ADR 0004 section 13).
    """

    def __post_init__(self) -> None:
        object.__setattr__(self, "segments", copy_list(self.segments))

    @staticmethod
    def from_json(value: object) -> Name:
        members = read_object(value, "Name")
        return Name(
            segments=required(
                members,
                "segments",
                "Name",
                list_reader("Name.segments", string_reader("Name.segments[]")),
            ),
            role=required(members, "role", "Name", open_enum_reader("Name.role", NameRole, NameRoleUnknown)),
            status=optional(members, "status", integer_reader("Name.status")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["segments"] = encode_list(self.segments, encode_plain)
        json["role"] = encode_open_enum(self.role)
        if self.status is not None:
            json["status"] = self.status
        return json


class NameRole(StrEnum):
    """The role of a name (ADR 0007 section 1)."""

    SCHEMA = "schema"
    INPUT = "input"
    OUTPUT = "output"
    QUERY = "query"
    HEADERS = "headers"
    PATH = "path"
    RESPONSE = "response"
    PARAMS = "params"
    ERROR = "error"
    ERRORS = "errors"
    PROPERTY = "property"
    ITEM = "item"
    VALUE = "value"
    VARIANT = "variant"
    ENDPOINTS = "endpoints"
    OPERATION = "operation"
    MEMBER = "member"
    ENUM_MEMBER = "enumMember"


@final
@dataclass(frozen=True, slots=True)
class NameRoleUnknown(UnknownEnumValue):
    """A value of NameRole this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in NameRole:
            raise IrModelError("NameRoleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class NamedTemplate:
    name: str
    value: Template

    @staticmethod
    def from_json(value: object) -> NamedTemplate:
        members = read_object(value, "NamedTemplate")
        return NamedTemplate(
            name=required(members, "name", "NamedTemplate", string_reader("NamedTemplate.name")),
            value=required(members, "value", "NamedTemplate", Template.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["value"] = self.value.to_json()
        return json


class NatureBase(StrEnum):
    """A base nature: every client's retry rule reads it."""

    REFUSED = "refused"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


@final
@dataclass(frozen=True, slots=True)
class NatureBaseUnknown(UnknownEnumValue):
    """A value of NatureBase this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in NatureBase:
            raise IrModelError("NatureBaseUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class NatureDecl:
    """A nature of the contract (ADR 0002 section 11)."""

    id: NatureId
    base: NatureBase | NatureBaseUnknown
    docs: Docs
    origin: Origin

    @staticmethod
    def from_json(value: object) -> NatureDecl:
        members = read_object(value, "NatureDecl")
        return NatureDecl(
            id=required(members, "id", "NatureDecl", string_reader("NatureDecl.id")),
            base=required(
                members,
                "base",
                "NatureDecl",
                open_enum_reader("NatureDecl.base", NatureBase, NatureBaseUnknown),
            ),
            docs=required(members, "docs", "NatureDecl", Docs.from_json),
            origin=required(members, "origin", "NatureDecl", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["base"] = encode_open_enum(self.base)
        json["docs"] = self.docs.to_json()
        json["origin"] = self.origin.to_json()
        return json


type NatureId = str
"""The id of a contract nature: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class NoSubject(RightSubject):
    kind: Literal["none"] = _dataclass_field(default="none", init=False)

    @staticmethod
    def from_json(value: object) -> NoSubject:
        members = read_object(value, "NoSubject")
        expect_tag(members, "kind", "none", "NoSubject")
        return NoSubject()

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OAuth2:
    """The OAuth 2 facts of a bearer scheme, for documents only."""

    flows: FrozenJson
    """OpenAPI OAuth flows, copied as written."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "flows", freeze(self.flows, "OAuth2.flows"))

    @staticmethod
    def from_json(value: object) -> OAuth2:
        members = read_object(value, "OAuth2")
        return OAuth2(flows=required(members, "flows", "OAuth2", opaque_reader("OAuth2.flows")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["flows"] = thaw(self.flows)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ObjectSchema(Schema):
    kind: Literal["object"] = _dataclass_field(default="object", init=False)
    properties: tuple[Property, ...]
    id: SchemaId
    name: Name
    type_name: str | None = None
    directions: tuple[Direction | DirectionUnknown, ...]
    examples: tuple[FrozenJson, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin
    deprecated: bool | None = None
    """The schema is deprecated (ADR 0003 section 1); absent means false."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "properties", copy_list(self.properties))
        object.__setattr__(self, "directions", copy_list(self.directions))
        object.__setattr__(self, "examples", copy_list(self.examples))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "ObjectSchema.extensions"))

    @staticmethod
    def from_json(value: object) -> ObjectSchema:
        members = read_object(value, "ObjectSchema")
        expect_tag(members, "kind", "object", "ObjectSchema")
        return ObjectSchema(
            properties=required(
                members,
                "properties",
                "ObjectSchema",
                list_reader("ObjectSchema.properties", Property.from_json),
            ),
            id=required(members, "id", "ObjectSchema", string_reader("ObjectSchema.id")),
            name=required(members, "name", "ObjectSchema", Name.from_json),
            type_name=optional(members, "typeName", string_reader("ObjectSchema.typeName")),
            directions=required(
                members,
                "directions",
                "ObjectSchema",
                list_reader(
                    "ObjectSchema.directions",
                    open_enum_reader("ObjectSchema.directions[]", Direction, DirectionUnknown),
                ),
            ),
            examples=required(
                members,
                "examples",
                "ObjectSchema",
                list_reader("ObjectSchema.examples", opaque_reader("ObjectSchema.examples[]")),
            ),
            docs=required(members, "docs", "ObjectSchema", Docs.from_json),
            extensions=required(members, "extensions", "ObjectSchema", extensions_reader("ObjectSchema.extensions")),
            origin=required(members, "origin", "ObjectSchema", Origin.from_json),
            deprecated=optional(members, "deprecated", boolean_reader("ObjectSchema.deprecated")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["properties"] = encode_list(self.properties, encode_model)
        json["id"] = self.id
        json["name"] = self.name.to_json()
        if self.type_name is not None:
            json["typeName"] = self.type_name
        json["directions"] = encode_list(self.directions, encode_open_enum)
        json["examples"] = encode_list(self.examples, thaw)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        if self.deprecated is not None:
            json["deprecated"] = self.deprecated
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ObjectTemplate(Template):
    kind: Literal["object"] = _dataclass_field(default="object", init=False)
    members: tuple[ObjectTemplateMember, ...]
    merge: Slot | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "members", copy_list(self.members))

    @staticmethod
    def from_json(value: object) -> ObjectTemplate:
        members = read_object(value, "ObjectTemplate")
        expect_tag(members, "kind", "object", "ObjectTemplate")
        return ObjectTemplate(
            members=required(
                members,
                "members",
                "ObjectTemplate",
                list_reader("ObjectTemplate.members", ObjectTemplateMember.from_json),
            ),
            merge=optional(members, "merge", string_reader("ObjectTemplate.merge")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["members"] = encode_list(self.members, encode_model)
        if self.merge is not None:
            json["merge"] = self.merge
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ObjectTemplateMember:
    name: MemberName
    value: Template

    @staticmethod
    def from_json(value: object) -> ObjectTemplateMember:
        members = read_object(value, "ObjectTemplateMember")
        return ObjectTemplateMember(
            name=required(members, "name", "ObjectTemplateMember", MemberName.from_json),
            value=required(members, "value", "ObjectTemplateMember", Template.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name.to_json()
        json["value"] = self.value.to_json()
        return json


class OpShorthand(StrEnum):
    """The ops shorthand an operation came from."""

    LIST = "list"
    GET = "get"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    BATCH = "batch"


@final
@dataclass(frozen=True, slots=True)
class OpShorthandUnknown(UnknownEnumValue):
    """A value of OpShorthand this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in OpShorthand:
            raise IrModelError("OpShorthandUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OpaqueTypeUse(TypeUse):
    """Any JSON value, unchecked (ADR 0003 section 2)."""

    kind: Literal["opaque"] = _dataclass_field(default="opaque", init=False)
    reason: Reason
    origin: Origin
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 2): an opaque value accepts null only with it; absent means false. A
    property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    """

    def __post_init__(self) -> None:
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> OpaqueTypeUse:
        members = read_object(value, "OpaqueTypeUse")
        expect_tag(members, "kind", "opaque", "OpaqueTypeUse")
        return OpaqueTypeUse(
            reason=required(members, "reason", "OpaqueTypeUse", string_reader("OpaqueTypeUse.reason")),
            origin=required(members, "origin", "OpaqueTypeUse", Origin.from_json),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("OpaqueTypeUse.examples", opaque_reader("OpaqueTypeUse.examples[]")),
            ),
            nullable=optional(members, "nullable", boolean_reader("OpaqueTypeUse.nullable")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        if self.nullable is not None:
            json["nullable"] = self.nullable
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Operation:
    """An HTTP operation (ADR 0004 section 7)."""

    kind: DeclarationKind | DeclarationKindUnknown
    id: OperationId
    name: Name
    surface: SurfaceId
    op: OpShorthand | OpShorthandUnknown | None = None
    resource: OperationResource | None = None
    features: tuple[Feature, ...]
    method: HttpMethod | HttpMethodUnknown
    path: str
    safe: bool
    params: Params
    unknown_query: UnknownQuery
    access: Access
    caller_kinds: tuple[CallerKind | CallerKindUnknown, ...]
    principal_requires: tuple[PrincipalRequirement, ...]
    scopes: tuple[OperationScope, ...]
    requires: tuple[Requirement, ...]
    bindings: tuple[Binding, ...]
    input: OperationInput | None = None
    responses: tuple[Response, ...]
    errors: tuple[OperationError, ...]
    field_rights: tuple[FieldRight, ...]
    idempotency: Idempotency | None = None
    concurrency: Concurrency | None = None
    owner: Owner | None = None
    cache: Cache | None = None
    paging: Paging | None = None
    filtered_by: RightId | None = None
    degradable: Degradable | None = None
    budget_ms: int | None = None
    deadline_header: str | None = None
    deprecated: Deprecation | None = None
    relays: OperationRef | None = None
    upstream: tuple[ServiceId, ...]
    maturity: OperationMaturity
    internal: bool
    csrf: Csrf | None = None
    format: FormatId
    tags: tuple[str, ...]
    examples: Mapping[str, OperationExample]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "features", copy_list(self.features))
        object.__setattr__(self, "caller_kinds", copy_list(self.caller_kinds))
        object.__setattr__(self, "principal_requires", copy_list(self.principal_requires))
        object.__setattr__(self, "scopes", copy_list(self.scopes))
        object.__setattr__(self, "requires", copy_list(self.requires))
        object.__setattr__(self, "bindings", copy_list(self.bindings))
        object.__setattr__(self, "responses", copy_list(self.responses))
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "field_rights", copy_list(self.field_rights))
        object.__setattr__(self, "upstream", copy_list(self.upstream))
        object.__setattr__(self, "tags", copy_list(self.tags))
        object.__setattr__(self, "examples", copy_map(self.examples))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Operation.extensions"))

    @staticmethod
    def from_json(value: object) -> Operation:
        members = read_object(value, "Operation")
        return Operation(
            kind=required(
                members,
                "kind",
                "Operation",
                open_enum_reader("Operation.kind", DeclarationKind, DeclarationKindUnknown),
            ),
            id=required(members, "id", "Operation", string_reader("Operation.id")),
            name=required(members, "name", "Operation", Name.from_json),
            surface=required(members, "surface", "Operation", string_reader("Operation.surface")),
            op=optional(members, "op", open_enum_reader("Operation.op", OpShorthand, OpShorthandUnknown)),
            resource=optional(members, "resource", OperationResource.from_json),
            features=required(
                members,
                "features",
                "Operation",
                list_reader("Operation.features", string_reader("Operation.features[]")),
            ),
            method=required(
                members,
                "method",
                "Operation",
                open_enum_reader("Operation.method", HttpMethod, HttpMethodUnknown),
            ),
            path=required(members, "path", "Operation", string_reader("Operation.path")),
            safe=required(members, "safe", "Operation", boolean_reader("Operation.safe")),
            params=required(members, "params", "Operation", Params.from_json),
            unknown_query=required(members, "unknownQuery", "Operation", UnknownQuery.from_json),
            access=required(members, "access", "Operation", Access.from_json),
            caller_kinds=required(
                members,
                "callerKinds",
                "Operation",
                list_reader(
                    "Operation.callerKinds",
                    open_enum_reader("Operation.callerKinds[]", CallerKind, CallerKindUnknown),
                ),
            ),
            principal_requires=required(
                members,
                "principalRequires",
                "Operation",
                list_reader("Operation.principalRequires", PrincipalRequirement.from_json),
            ),
            scopes=required(members, "scopes", "Operation", list_reader("Operation.scopes", OperationScope.from_json)),
            requires=required(
                members,
                "requires",
                "Operation",
                list_reader("Operation.requires", Requirement.from_json),
            ),
            bindings=required(members, "bindings", "Operation", list_reader("Operation.bindings", Binding.from_json)),
            input=optional(members, "input", OperationInput.from_json),
            responses=required(
                members,
                "responses",
                "Operation",
                list_reader("Operation.responses", Response.from_json),
            ),
            errors=required(members, "errors", "Operation", list_reader("Operation.errors", OperationError.from_json)),
            field_rights=required(
                members,
                "fieldRights",
                "Operation",
                list_reader("Operation.fieldRights", FieldRight.from_json),
            ),
            idempotency=optional(members, "idempotency", Idempotency.from_json),
            concurrency=optional(members, "concurrency", Concurrency.from_json),
            owner=optional(members, "owner", Owner.from_json),
            cache=optional(members, "cache", Cache.from_json),
            paging=optional(members, "paging", Paging.from_json),
            filtered_by=optional(members, "filteredBy", string_reader("Operation.filteredBy")),
            degradable=optional(members, "degradable", Degradable.from_json),
            budget_ms=optional(members, "budgetMs", integer_reader("Operation.budgetMs")),
            deadline_header=optional(members, "deadlineHeader", string_reader("Operation.deadlineHeader")),
            deprecated=optional(members, "deprecated", Deprecation.from_json),
            relays=optional(members, "relays", OperationRef.from_json),
            upstream=required(
                members,
                "upstream",
                "Operation",
                list_reader("Operation.upstream", string_reader("Operation.upstream[]")),
            ),
            maturity=required(members, "maturity", "Operation", OperationMaturity.from_json),
            internal=required(members, "internal", "Operation", boolean_reader("Operation.internal")),
            csrf=optional(members, "csrf", Csrf.from_json),
            format=required(members, "format", "Operation", string_reader("Operation.format")),
            tags=required(
                members,
                "tags",
                "Operation",
                list_reader("Operation.tags", string_reader("Operation.tags[]")),
            ),
            examples=required(
                members,
                "examples",
                "Operation",
                map_reader("Operation.examples", OperationExample.from_json),
            ),
            docs=required(members, "docs", "Operation", Docs.from_json),
            extensions=required(members, "extensions", "Operation", extensions_reader("Operation.extensions")),
            origin=required(members, "origin", "Operation", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = encode_open_enum(self.kind)
        json["id"] = self.id
        json["name"] = self.name.to_json()
        json["surface"] = self.surface
        if self.op is not None:
            json["op"] = encode_open_enum(self.op)
        if self.resource is not None:
            json["resource"] = self.resource.to_json()
        json["features"] = encode_list(self.features, encode_plain)
        json["method"] = encode_open_enum(self.method)
        json["path"] = self.path
        json["safe"] = self.safe
        json["params"] = self.params.to_json()
        json["unknownQuery"] = self.unknown_query.to_json()
        json["access"] = self.access.to_json()
        json["callerKinds"] = encode_list(self.caller_kinds, encode_open_enum)
        json["principalRequires"] = encode_list(self.principal_requires, encode_model)
        json["scopes"] = encode_list(self.scopes, encode_model)
        json["requires"] = encode_list(self.requires, encode_model)
        json["bindings"] = encode_list(self.bindings, encode_model)
        if self.input is not None:
            json["input"] = self.input.to_json()
        json["responses"] = encode_list(self.responses, encode_model)
        json["errors"] = encode_list(self.errors, encode_model)
        json["fieldRights"] = encode_list(self.field_rights, encode_model)
        if self.idempotency is not None:
            json["idempotency"] = self.idempotency.to_json()
        if self.concurrency is not None:
            json["concurrency"] = self.concurrency.to_json()
        if self.owner is not None:
            json["owner"] = self.owner.to_json()
        if self.cache is not None:
            json["cache"] = self.cache.to_json()
        if self.paging is not None:
            json["paging"] = self.paging.to_json()
        if self.filtered_by is not None:
            json["filteredBy"] = self.filtered_by
        if self.degradable is not None:
            json["degradable"] = self.degradable.to_json()
        if self.budget_ms is not None:
            json["budgetMs"] = self.budget_ms
        if self.deadline_header is not None:
            json["deadlineHeader"] = self.deadline_header
        if self.deprecated is not None:
            json["deprecated"] = self.deprecated.to_json()
        if self.relays is not None:
            json["relays"] = self.relays.to_json()
        json["upstream"] = encode_list(self.upstream, encode_plain)
        json["maturity"] = self.maturity.to_json()
        json["internal"] = self.internal
        if self.csrf is not None:
            json["csrf"] = self.csrf.to_json()
        json["format"] = self.format
        json["tags"] = encode_list(self.tags, encode_plain)
        json["examples"] = encode_map(self.examples, encode_model)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationError:
    """A code the operation can answer, declared or derived."""

    code: ErrorCode
    example: FrozenJson | Omitted = OMITTED
    roles: tuple[ErrorRoleBinding, ...] | None = None
    """Sorted by role; absent when the code answers no role here."""
    retry_header: RetryHeader | None = None
    derived_from: DerivedFrom | None = None
    origin: Origin | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.example, Omitted):
            object.__setattr__(self, "example", freeze(self.example, "OperationError.example"))
        if self.roles is not None:
            object.__setattr__(self, "roles", copy_list(self.roles))

    @staticmethod
    def from_json(value: object) -> OperationError:
        members = read_object(value, "OperationError")
        return OperationError(
            code=required(members, "code", "OperationError", string_reader("OperationError.code")),
            example=optional_opaque(members, "example", "OperationError.example"),
            roles=optional(members, "roles", list_reader("OperationError.roles", ErrorRoleBinding.from_json)),
            retry_header=optional(members, "retryHeader", RetryHeader.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
            origin=optional(members, "origin", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["code"] = self.code
        if not isinstance(self.example, Omitted):
            json["example"] = thaw(self.example)
        if self.roles is not None:
            json["roles"] = encode_list(self.roles, encode_model)
        if self.retry_header is not None:
            json["retryHeader"] = self.retry_header.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationExample:
    """A route example; with 'error', 'value' holds the code's params."""

    status: int | None = None
    request: bool | None = None
    error: ErrorCode | None = None
    value: FrozenJson

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", freeze(self.value, "OperationExample.value"))

    @staticmethod
    def from_json(value: object) -> OperationExample:
        members = read_object(value, "OperationExample")
        return OperationExample(
            status=optional(members, "status", integer_reader("OperationExample.status")),
            request=optional(members, "request", boolean_reader("OperationExample.request")),
            error=optional(members, "error", string_reader("OperationExample.error")),
            value=required(members, "value", "OperationExample", opaque_reader("OperationExample.value")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.status is not None:
            json["status"] = self.status
        if self.request is not None:
            json["request"] = self.request
        if self.error is not None:
            json["error"] = self.error
        json["value"] = thaw(self.value)
        return json


type OperationId = str
"""An operation id (ADR 0004 section 7)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationInput:
    """The request body."""

    media: InputMediaType | InputMediaTypeUnknown
    schema: TypeUse
    body_limit_bytes: int
    raw_body: bool
    fields: tuple[InputField, ...] | None = None
    proofs: tuple[InputProof, ...] | None = None
    """The body fields of the rule proofs read in the body, each once, in requirement order; absent when there is none.
    Targets render the body as the input schema's properties followed by these fields.
    """
    origin: Origin

    def __post_init__(self) -> None:
        if self.fields is not None:
            object.__setattr__(self, "fields", copy_list(self.fields))
        if self.proofs is not None:
            object.__setattr__(self, "proofs", copy_list(self.proofs))

    @staticmethod
    def from_json(value: object) -> OperationInput:
        members = read_object(value, "OperationInput")
        return OperationInput(
            media=required(
                members,
                "media",
                "OperationInput",
                open_enum_reader("OperationInput.media", InputMediaType, InputMediaTypeUnknown),
            ),
            schema=required(members, "schema", "OperationInput", TypeUse.from_json),
            body_limit_bytes=required(
                members,
                "bodyLimitBytes",
                "OperationInput",
                integer_reader("OperationInput.bodyLimitBytes"),
            ),
            raw_body=required(members, "rawBody", "OperationInput", boolean_reader("OperationInput.rawBody")),
            fields=optional(members, "fields", list_reader("OperationInput.fields", InputField.from_json)),
            proofs=optional(members, "proofs", list_reader("OperationInput.proofs", InputProof.from_json)),
            origin=required(members, "origin", "OperationInput", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["media"] = encode_open_enum(self.media)
        json["schema"] = self.schema.to_json()
        json["bodyLimitBytes"] = self.body_limit_bytes
        json["rawBody"] = self.raw_body
        if self.fields is not None:
            json["fields"] = encode_list(self.fields, encode_model)
        if self.proofs is not None:
            json["proofs"] = encode_list(self.proofs, encode_model)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationMaturity:
    level: Maturity | MaturityUnknown
    source: MaturitySource | MaturitySourceUnknown
    reason: Reason | None = None
    origin: Origin

    @staticmethod
    def from_json(value: object) -> OperationMaturity:
        members = read_object(value, "OperationMaturity")
        return OperationMaturity(
            level=required(
                members,
                "level",
                "OperationMaturity",
                open_enum_reader("OperationMaturity.level", Maturity, MaturityUnknown),
            ),
            source=required(
                members,
                "source",
                "OperationMaturity",
                open_enum_reader("OperationMaturity.source", MaturitySource, MaturitySourceUnknown),
            ),
            reason=optional(members, "reason", string_reader("OperationMaturity.reason")),
            origin=required(members, "origin", "OperationMaturity", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["level"] = encode_open_enum(self.level)
        json["source"] = encode_open_enum(self.source)
        if self.reason is not None:
            json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationRef:
    """A kind-tagged operation reference (ADR 0014)."""

    kind: DeclarationKind | DeclarationKindUnknown
    api: str
    id: OperationId

    @staticmethod
    def from_json(value: object) -> OperationRef:
        members = read_object(value, "OperationRef")
        return OperationRef(
            kind=required(
                members,
                "kind",
                "OperationRef",
                open_enum_reader("OperationRef.kind", DeclarationKind, DeclarationKindUnknown),
            ),
            api=required(members, "api", "OperationRef", string_reader("OperationRef.api")),
            id=required(members, "id", "OperationRef", string_reader("OperationRef.id")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = encode_open_enum(self.kind)
        json["api"] = self.api
        json["id"] = self.id
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationResource:
    """The collection or single it belongs to."""

    type: str
    id_param: str | None = None
    id_property: str | None = None

    @staticmethod
    def from_json(value: object) -> OperationResource:
        members = read_object(value, "OperationResource")
        return OperationResource(
            type=required(members, "type", "OperationResource", string_reader("OperationResource.type")),
            id_param=optional(members, "idParam", string_reader("OperationResource.idParam")),
            id_property=optional(members, "idProperty", string_reader("OperationResource.idProperty")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["type"] = self.type
        if self.id_param is not None:
            json["idParam"] = self.id_param
        if self.id_property is not None:
            json["idProperty"] = self.id_property
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OperationScope:
    scope: ScopeId
    source: ValueSource
    """Where the scope id is read; 'in: resolver' for an application resolver."""
    origin: Origin

    @staticmethod
    def from_json(value: object) -> OperationScope:
        members = read_object(value, "OperationScope")
        return OperationScope(
            scope=required(members, "scope", "OperationScope", string_reader("OperationScope.scope")),
            source=required(members, "source", "OperationScope", ValueSource.from_json),
            origin=required(members, "origin", "OperationScope", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["scope"] = self.scope
        json["source"] = self.source.to_json()
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class OptionalAccess(Access):
    kind: Literal["optional"] = _dataclass_field(default="optional", init=False)
    identity: IdentityId
    schemes: tuple[SchemeId, ...]
    reason: Reason
    on_refused: RefusedCredential | RefusedCredentialUnknown
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "schemes", copy_list(self.schemes))

    @staticmethod
    def from_json(value: object) -> OptionalAccess:
        members = read_object(value, "OptionalAccess")
        expect_tag(members, "kind", "optional", "OptionalAccess")
        return OptionalAccess(
            identity=required(members, "identity", "OptionalAccess", string_reader("OptionalAccess.identity")),
            schemes=required(
                members,
                "schemes",
                "OptionalAccess",
                list_reader("OptionalAccess.schemes", string_reader("OptionalAccess.schemes[]")),
            ),
            reason=required(members, "reason", "OptionalAccess", string_reader("OptionalAccess.reason")),
            on_refused=required(
                members,
                "onRefused",
                "OptionalAccess",
                open_enum_reader("OptionalAccess.onRefused", RefusedCredential, RefusedCredentialUnknown),
            ),
            origin=required(members, "origin", "OptionalAccess", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["identity"] = self.identity
        json["schemes"] = encode_list(self.schemes, encode_plain)
        json["reason"] = self.reason
        json["onRefused"] = encode_open_enum(self.on_refused)
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Origin:
    """Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section
    6).
    """

    api: str | None = None
    """Set on an element copied from another api by a relay route."""
    layer: str
    """'api', 'shared', 'base', 'pack:<name>', 'core' for a declaration the compiler supplies (its pointer starts with
    its entry of formats, errors or schemas, with no side-table entry), or 'workspace' for a diagnostic on
    workspace.yaml (no IR element carries it). Closed: the one exception to open enums (ADR 0004 section 13).
    """
    pointer: str

    @staticmethod
    def from_json(value: object) -> Origin:
        members = read_object(value, "Origin")
        return Origin(
            api=optional(members, "api", string_reader("Origin.api")),
            layer=required(members, "layer", "Origin", string_reader("Origin.layer")),
            pointer=required(members, "pointer", "Origin", string_reader("Origin.pointer")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.api is not None:
            json["api"] = self.api
        json["layer"] = self.layer
        json["pointer"] = self.pointer
        return json


class OutputEnumForm(StrEnum):
    """Whether an output enum is closed, or open with a fallback a client keeps."""

    ENUM = "enum"
    OPEN = "open"


@final
@dataclass(frozen=True, slots=True)
class OutputEnumFormUnknown(UnknownEnumValue):
    """A value of OutputEnumForm this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in OutputEnumForm:
            raise IrModelError("OutputEnumFormUnknown: the value is a known one")


class OverLimitPolicy(StrEnum):
    """What a limit above maxLimit does."""

    REJECT = "reject"
    CLAMP = "clamp"


@final
@dataclass(frozen=True, slots=True)
class OverLimitPolicyUnknown(UnknownEnumValue):
    """A value of OverLimitPolicy this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in OverLimitPolicy:
            raise IrModelError("OverLimitPolicyUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Owner:
    kind: OwnerKind | OwnerKindUnknown
    origin: Origin

    @staticmethod
    def from_json(value: object) -> Owner:
        members = read_object(value, "Owner")
        return Owner(
            kind=required(members, "kind", "Owner", open_enum_reader("Owner.kind", OwnerKind, OwnerKindUnknown)),
            origin=required(members, "origin", "Owner", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = encode_open_enum(self.kind)
        json["origin"] = self.origin.to_json()
        return json


class OwnerKind(StrEnum):
    """Who owns the resource an operation writes."""

    CALLER = "caller"


@final
@dataclass(frozen=True, slots=True)
class OwnerKindUnknown(UnknownEnumValue):
    """A value of OwnerKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in OwnerKind:
            raise IrModelError("OwnerKindUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PackRef:
    """A pack applied, in application order."""

    name: str
    version: str

    @staticmethod
    def from_json(value: object) -> PackRef:
        members = read_object(value, "PackRef")
        return PackRef(
            name=required(members, "name", "PackRef", string_reader("PackRef.name")),
            version=required(members, "version", "PackRef", string_reader("PackRef.version")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["version"] = self.version
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Paging:
    """The paging of a list; 'style' is absent for an unpaged list."""

    style: PagingId | None = None
    max_limit: int | None = None
    default_limit: int | None = None
    over_limit: OverLimitPolicy | OverLimitPolicyUnknown
    token: PagingToken | PagingTokenUnknown | None = None
    sort_keys: tuple[SortKey, ...]
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "sort_keys", copy_list(self.sort_keys))

    @staticmethod
    def from_json(value: object) -> Paging:
        members = read_object(value, "Paging")
        return Paging(
            style=optional(members, "style", string_reader("Paging.style")),
            max_limit=optional(members, "maxLimit", integer_reader("Paging.maxLimit")),
            default_limit=optional(members, "defaultLimit", integer_reader("Paging.defaultLimit")),
            over_limit=required(
                members,
                "overLimit",
                "Paging",
                open_enum_reader("Paging.overLimit", OverLimitPolicy, OverLimitPolicyUnknown),
            ),
            token=optional(members, "token", open_enum_reader("Paging.token", PagingToken, PagingTokenUnknown)),
            sort_keys=required(members, "sortKeys", "Paging", list_reader("Paging.sortKeys", SortKey.from_json)),
            origin=required(members, "origin", "Paging", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.style is not None:
            json["style"] = self.style
        if self.max_limit is not None:
            json["maxLimit"] = self.max_limit
        if self.default_limit is not None:
            json["defaultLimit"] = self.default_limit
        json["overLimit"] = encode_open_enum(self.over_limit)
        if self.token is not None:
            json["token"] = encode_open_enum(self.token)
        json["sortKeys"] = encode_list(self.sort_keys, encode_model)
        json["origin"] = self.origin.to_json()
        return json


type PagingId = str
"""The id of a paging style: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PagingLink:
    rel: str
    role: UrlRole | UrlRoleUnknown

    @staticmethod
    def from_json(value: object) -> PagingLink:
        members = read_object(value, "PagingLink")
        return PagingLink(
            rel=required(members, "rel", "PagingLink", string_reader("PagingLink.rel")),
            role=required(members, "role", "PagingLink", open_enum_reader("PagingLink.role", UrlRole, UrlRoleUnknown)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["rel"] = self.rel
        json["role"] = encode_open_enum(self.role)
        return json


class PagingParamPlacement(StrEnum):
    """Where a paging request parameter is read."""

    QUERY = "query"
    HEADER = "header"


@final
@dataclass(frozen=True, slots=True)
class PagingParamPlacementUnknown(UnknownEnumValue):
    """A value of PagingParamPlacement this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PagingParamPlacement:
            raise IrModelError("PagingParamPlacementUnknown: the value is a known one")


class PagingParamStyle(StrEnum):
    """How a sort parameter is written."""

    SIGNED = "signed"
    PAIR = "pair"
    KEYED = "keyed"
    SPLIT = "split"


@final
@dataclass(frozen=True, slots=True)
class PagingParamStyleUnknown(UnknownEnumValue):
    """A value of PagingParamStyle this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PagingParamStyle:
            raise IrModelError("PagingParamStyleUnknown: the value is a known one")


class PagingPosition(StrEnum):
    """How a paging style positions a page."""

    CURSOR = "cursor"
    PAGE = "page"
    OFFSET = "offset"
    SINCE = "since"


@final
@dataclass(frozen=True, slots=True)
class PagingPositionUnknown(UnknownEnumValue):
    """A value of PagingPosition this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PagingPosition:
            raise IrModelError("PagingPositionUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PagingRequestRole:
    role: PagingRole | PagingRoleUnknown
    in_: PagingParamPlacement | PagingParamPlacementUnknown
    name: str
    base: int | None = None
    style: PagingParamStyle | PagingParamStyleUnknown | None = None
    direction: str | None = None
    """With style 'split': the direction parameter's name."""

    @staticmethod
    def from_json(value: object) -> PagingRequestRole:
        members = read_object(value, "PagingRequestRole")
        return PagingRequestRole(
            role=required(
                members,
                "role",
                "PagingRequestRole",
                open_enum_reader("PagingRequestRole.role", PagingRole, PagingRoleUnknown),
            ),
            in_=required(
                members,
                "in",
                "PagingRequestRole",
                open_enum_reader("PagingRequestRole.in", PagingParamPlacement, PagingParamPlacementUnknown),
            ),
            name=required(members, "name", "PagingRequestRole", string_reader("PagingRequestRole.name")),
            base=optional(members, "base", integer_reader("PagingRequestRole.base")),
            style=optional(
                members,
                "style",
                open_enum_reader("PagingRequestRole.style", PagingParamStyle, PagingParamStyleUnknown),
            ),
            direction=optional(members, "direction", string_reader("PagingRequestRole.direction")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["role"] = encode_open_enum(self.role)
        json["in"] = encode_open_enum(self.in_)
        json["name"] = self.name
        if self.base is not None:
            json["base"] = self.base
        if self.style is not None:
            json["style"] = encode_open_enum(self.style)
        if self.direction is not None:
            json["direction"] = self.direction
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PagingResponse:
    body: Template | None = None
    """The whole page body; absent when the style adds 'meta' to the format's page."""
    meta: tuple[NamedTemplate, ...]
    headers: tuple[HeaderTemplate, ...]
    links: tuple[PagingLink, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "meta", copy_list(self.meta))
        object.__setattr__(self, "headers", copy_list(self.headers))
        object.__setattr__(self, "links", copy_list(self.links))

    @staticmethod
    def from_json(value: object) -> PagingResponse:
        members = read_object(value, "PagingResponse")
        return PagingResponse(
            body=optional(members, "body", Template.from_json),
            meta=required(
                members,
                "meta",
                "PagingResponse",
                list_reader("PagingResponse.meta", NamedTemplate.from_json),
            ),
            headers=required(
                members,
                "headers",
                "PagingResponse",
                list_reader("PagingResponse.headers", HeaderTemplate.from_json),
            ),
            links=required(
                members,
                "links",
                "PagingResponse",
                list_reader("PagingResponse.links", PagingLink.from_json),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.body is not None:
            json["body"] = self.body.to_json()
        json["meta"] = encode_list(self.meta, encode_model)
        json["headers"] = encode_list(self.headers, encode_model)
        json["links"] = encode_list(self.links, encode_model)
        return json


class PagingRole(StrEnum):
    """The role of a paging request parameter."""

    CURSOR = "cursor"
    AFTER = "after"
    BEFORE = "before"
    PAGE = "page"
    OFFSET = "offset"
    SINCE = "since"
    LIMIT = "limit"
    SORT = "sort"


@final
@dataclass(frozen=True, slots=True)
class PagingRoleUnknown(UnknownEnumValue):
    """A value of PagingRole this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PagingRole:
            raise IrModelError("PagingRoleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PagingStyle:
    """A paging style (A31)."""

    id: PagingId
    origin: Origin
    position: PagingPosition | PagingPositionUnknown
    absent: Absent | AbsentUnknown
    request: tuple[PagingRequestRole, ...]
    response: PagingResponse
    handler_result: tuple[HandlerResultMember | HandlerResultMemberUnknown, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "request", copy_list(self.request))
        object.__setattr__(self, "handler_result", copy_list(self.handler_result))

    @staticmethod
    def from_json(value: object) -> PagingStyle:
        members = read_object(value, "PagingStyle")
        return PagingStyle(
            id=required(members, "id", "PagingStyle", string_reader("PagingStyle.id")),
            origin=required(members, "origin", "PagingStyle", Origin.from_json),
            position=required(
                members,
                "position",
                "PagingStyle",
                open_enum_reader("PagingStyle.position", PagingPosition, PagingPositionUnknown),
            ),
            absent=required(
                members,
                "absent",
                "PagingStyle",
                open_enum_reader("PagingStyle.absent", Absent, AbsentUnknown),
            ),
            request=required(
                members,
                "request",
                "PagingStyle",
                list_reader("PagingStyle.request", PagingRequestRole.from_json),
            ),
            response=required(members, "response", "PagingStyle", PagingResponse.from_json),
            handler_result=required(
                members,
                "handlerResult",
                "PagingStyle",
                list_reader(
                    "PagingStyle.handlerResult",
                    open_enum_reader("PagingStyle.handlerResult[]", HandlerResultMember, HandlerResultMemberUnknown),
                ),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["origin"] = self.origin.to_json()
        json["position"] = encode_open_enum(self.position)
        json["absent"] = encode_open_enum(self.absent)
        json["request"] = encode_list(self.request, encode_model)
        json["response"] = self.response.to_json()
        json["handlerResult"] = encode_list(self.handler_result, encode_open_enum)
        return json


class PagingToken(StrEnum):
    """What a paging token holds."""

    OPAQUE = "opaque"
    INSTANT = "instant"


@final
@dataclass(frozen=True, slots=True)
class PagingTokenUnknown(UnknownEnumValue):
    """A value of PagingToken this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PagingToken:
            raise IrModelError("PagingTokenUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Param:
    """A path, query or header parameter, declared (origin) or derived (derivedFrom)."""

    name: str
    type: TypeUse
    required: bool
    wire: QueryWire | None = None
    default: FrozenJson | Omitted = OMITTED
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.default, Omitted):
            object.__setattr__(self, "default", freeze(self.default, "Param.default"))

    @staticmethod
    def from_json(value: object) -> Param:
        members = read_object(value, "Param")
        return Param(
            name=required(members, "name", "Param", string_reader("Param.name")),
            type=required(members, "type", "Param", TypeUse.from_json),
            required=required(members, "required", "Param", boolean_reader("Param.required")),
            wire=optional(members, "wire", QueryWire.from_json),
            default=optional_opaque(members, "default", "Param.default"),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["type"] = self.type.to_json()
        json["required"] = self.required
        if self.wire is not None:
            json["wire"] = self.wire.to_json()
        if not isinstance(self.default, Omitted):
            json["default"] = thaw(self.default)
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Params:
    path: tuple[Param, ...]
    query: tuple[Param, ...]
    header: tuple[Param, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", copy_list(self.path))
        object.__setattr__(self, "query", copy_list(self.query))
        object.__setattr__(self, "header", copy_list(self.header))

    @staticmethod
    def from_json(value: object) -> Params:
        members = read_object(value, "Params")
        return Params(
            path=required(members, "path", "Params", list_reader("Params.path", Param.from_json)),
            query=required(members, "query", "Params", list_reader("Params.query", Param.from_json)),
            header=required(members, "header", "Params", list_reader("Params.header", Param.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["path"] = encode_list(self.path, encode_model)
        json["query"] = encode_list(self.query, encode_model)
        json["header"] = encode_list(self.header, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PathApiVersion(ApiVersion):
    kind: Literal["path"] = _dataclass_field(default="path", init=False)
    number: int
    """The number paths carry ('/v1')."""

    @staticmethod
    def from_json(value: object) -> PathApiVersion:
        members = read_object(value, "PathApiVersion")
        expect_tag(members, "kind", "path", "PathApiVersion")
        return PathApiVersion(
            number=required(members, "number", "PathApiVersion", integer_reader("PathApiVersion.number")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["number"] = self.number
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PathVersion:
    value: PathVersionMode | PathVersionModeUnknown
    origin: Origin

    @staticmethod
    def from_json(value: object) -> PathVersion:
        members = read_object(value, "PathVersion")
        return PathVersion(
            value=required(
                members,
                "value",
                "PathVersion",
                open_enum_reader("PathVersion.value", PathVersionMode, PathVersionModeUnknown),
            ),
            origin=required(members, "origin", "PathVersion", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["value"] = encode_open_enum(self.value)
        json["origin"] = self.origin.to_json()
        return json


class PathVersionMode(StrEnum):
    """Whether paths carry the version prefix."""

    PREFIX = "prefix"
    NONE = "none"


@final
@dataclass(frozen=True, slots=True)
class PathVersionModeUnknown(UnknownEnumValue):
    """A value of PathVersionMode this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in PathVersionMode:
            raise IrModelError("PathVersionModeUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Pattern:
    """A pattern refinement: the written text and its normalised form (ADR 0003 section 9)."""

    source: str
    normalized: str

    @staticmethod
    def from_json(value: object) -> Pattern:
        members = read_object(value, "Pattern")
        return Pattern(
            source=required(members, "source", "Pattern", string_reader("Pattern.source")),
            normalized=required(members, "normalized", "Pattern", string_reader("Pattern.normalized")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["source"] = self.source
        json["normalized"] = self.normalized
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PlainMemberName(MemberName):
    kind: Literal["text"] = _dataclass_field(default="text", init=False)
    text: str

    @staticmethod
    def from_json(value: object) -> PlainMemberName:
        members = read_object(value, "PlainMemberName")
        expect_tag(members, "kind", "text", "PlainMemberName")
        return PlainMemberName(text=required(members, "text", "PlainMemberName", string_reader("PlainMemberName.text")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["text"] = self.text
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PlainTextPart(TextPart):
    kind: Literal["text"] = _dataclass_field(default="text", init=False)
    text: str

    @staticmethod
    def from_json(value: object) -> PlainTextPart:
        members = read_object(value, "PlainTextPart")
        expect_tag(members, "kind", "text", "PlainTextPart")
        return PlainTextPart(text=required(members, "text", "PlainTextPart", string_reader("PlainTextPart.text")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["text"] = self.text
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PrincipalRequirement:
    field: str
    origin: Origin

    @staticmethod
    def from_json(value: object) -> PrincipalRequirement:
        members = read_object(value, "PrincipalRequirement")
        return PrincipalRequirement(
            field=required(members, "field", "PrincipalRequirement", string_reader("PrincipalRequirement.field")),
            origin=required(members, "origin", "PrincipalRequirement", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["field"] = self.field
        json["origin"] = self.origin.to_json()
        return json


class ProofPlacement(StrEnum):
    """Where a rule proof is read."""

    BODY = "body"
    HEADER = "header"


@final
@dataclass(frozen=True, slots=True)
class ProofPlacementUnknown(UnknownEnumValue):
    """A value of ProofPlacement this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ProofPlacement:
            raise IrModelError("ProofPlacementUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Property:
    """An object property; the wire name stays 'name' (ADR 0004 section 5)."""

    name: str
    type: TypeUse
    optional: bool
    nullable: bool
    sensitive: bool
    restricted_to: FieldRestriction | None = None
    default: FrozenJson | Omitted = OMITTED
    deprecated: bool
    code_name: Name | None = None
    docs: Docs
    extensions: Extensions
    origin: Origin
    derived_from: DerivedFrom | None = None
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written on the property, each parsed against its type (ADR 0003 section 11)."""

    def __post_init__(self) -> None:
        if not isinstance(self.default, Omitted):
            object.__setattr__(self, "default", freeze(self.default, "Property.default"))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Property.extensions"))
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> Property:
        members = read_object(value, "Property")
        return Property(
            name=required(members, "name", "Property", string_reader("Property.name")),
            type=required(members, "type", "Property", TypeUse.from_json),
            optional=required(members, "optional", "Property", boolean_reader("Property.optional")),
            nullable=required(members, "nullable", "Property", boolean_reader("Property.nullable")),
            sensitive=required(members, "sensitive", "Property", boolean_reader("Property.sensitive")),
            restricted_to=optional(members, "restrictedTo", FieldRestriction.from_json),
            default=optional_opaque(members, "default", "Property.default"),
            deprecated=required(members, "deprecated", "Property", boolean_reader("Property.deprecated")),
            code_name=optional(members, "codeName", Name.from_json),
            docs=required(members, "docs", "Property", Docs.from_json),
            extensions=required(members, "extensions", "Property", extensions_reader("Property.extensions")),
            origin=required(members, "origin", "Property", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("Property.examples", opaque_reader("Property.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["type"] = self.type.to_json()
        json["optional"] = self.optional
        json["nullable"] = self.nullable
        json["sensitive"] = self.sensitive
        if self.restricted_to is not None:
            json["restrictedTo"] = self.restricted_to.to_json()
        if not isinstance(self.default, Omitted):
            json["default"] = thaw(self.default)
        json["deprecated"] = self.deprecated
        if self.code_name is not None:
            json["codeName"] = self.code_name.to_json()
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class PublicAccess(Access):
    kind: Literal["public"] = _dataclass_field(default="public", init=False)
    reason: Reason
    origin: Origin

    @staticmethod
    def from_json(value: object) -> PublicAccess:
        members = read_object(value, "PublicAccess")
        expect_tag(members, "kind", "public", "PublicAccess")
        return PublicAccess(
            reason=required(members, "reason", "PublicAccess", string_reader("PublicAccess.reason")),
            origin=required(members, "origin", "PublicAccess", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["reason"] = self.reason
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class QueryScheme(Scheme):
    """A credential in a query parameter."""

    id: SchemeId
    kind: Literal["query"] = _dataclass_field(default="query", init=False)
    name: str
    """The query parameter name."""
    origin: Origin

    @staticmethod
    def from_json(value: object) -> QueryScheme:
        members = read_object(value, "QueryScheme")
        expect_tag(members, "kind", "query", "QueryScheme")
        return QueryScheme(
            id=required(members, "id", "QueryScheme", string_reader("QueryScheme.id")),
            name=required(members, "name", "QueryScheme", string_reader("QueryScheme.name")),
            origin=required(members, "origin", "QueryScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["name"] = self.name
        json["origin"] = self.origin.to_json()
        return json


class QueryStyle(StrEnum):
    """The OpenAPI style of a query value."""

    FORM = "form"
    DEEP_OBJECT = "deepObject"


@final
@dataclass(frozen=True, slots=True)
class QueryStyleUnknown(UnknownEnumValue):
    """A value of QueryStyle this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in QueryStyle:
            raise IrModelError("QueryStyleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class QueryWire:
    """The wire form of a query parameter (FR-30)."""

    kind: QueryWireKind | QueryWireKindUnknown
    style: QueryStyle | QueryStyleUnknown
    explode: bool
    brackets: bool
    """A list sent as 'name[]'."""

    @staticmethod
    def from_json(value: object) -> QueryWire:
        members = read_object(value, "QueryWire")
        return QueryWire(
            kind=required(
                members,
                "kind",
                "QueryWire",
                open_enum_reader("QueryWire.kind", QueryWireKind, QueryWireKindUnknown),
            ),
            style=required(
                members,
                "style",
                "QueryWire",
                open_enum_reader("QueryWire.style", QueryStyle, QueryStyleUnknown),
            ),
            explode=required(members, "explode", "QueryWire", boolean_reader("QueryWire.explode")),
            brackets=required(members, "brackets", "QueryWire", boolean_reader("QueryWire.brackets")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = encode_open_enum(self.kind)
        json["style"] = encode_open_enum(self.style)
        json["explode"] = self.explode
        json["brackets"] = self.brackets
        return json


class QueryWireKind(StrEnum):
    """How a query value is written (FR-30)."""

    NUMBER = "number"
    BOOLEAN = "boolean"
    LIST = "list"
    TEXT = "text"
    OBJECT = "object"


@final
@dataclass(frozen=True, slots=True)
class QueryWireKindUnknown(UnknownEnumValue):
    """A value of QueryWireKind this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in QueryWireKind:
            raise IrModelError("QueryWireKindUnknown: the value is a known one")


type Reason = str
"""The written reason of an exception: non-empty, without leading or trailing white space (A36, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RefTypeUse(TypeUse):
    kind: Literal["ref"] = _dataclass_field(default="ref", init=False)
    schema: SchemaId
    unknown_keys: UnknownKeys | None = None
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out:
    Property.nullable holds it (invariant ir.property.nullable).
    """
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""

    def __post_init__(self) -> None:
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> RefTypeUse:
        members = read_object(value, "RefTypeUse")
        expect_tag(members, "kind", "ref", "RefTypeUse")
        return RefTypeUse(
            schema=required(members, "schema", "RefTypeUse", string_reader("RefTypeUse.schema")),
            unknown_keys=optional(members, "unknownKeys", UnknownKeys.from_json),
            nullable=optional(members, "nullable", boolean_reader("RefTypeUse.nullable")),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("RefTypeUse.examples", opaque_reader("RefTypeUse.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["schema"] = self.schema
        if self.unknown_keys is not None:
            json["unknownKeys"] = self.unknown_keys.to_json()
        if self.nullable is not None:
            json["nullable"] = self.nullable
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Refinements:
    """The refinements of a scalar (ADR 0003 sections 1 and 8); numeric ones are decimal literal strings, compared
    numerically.
    """

    min_length: int | None = None
    max_length: int | None = None
    pattern: Pattern | None = None
    minimum: DecimalLiteral | None = None
    maximum: DecimalLiteral | None = None
    exclusive_minimum: DecimalLiteral | None = None
    exclusive_maximum: DecimalLiteral | None = None
    multiple_of: DecimalLiteral | None = None

    @staticmethod
    def from_json(value: object) -> Refinements:
        members = read_object(value, "Refinements")
        return Refinements(
            min_length=optional(members, "minLength", integer_reader("Refinements.minLength")),
            max_length=optional(members, "maxLength", integer_reader("Refinements.maxLength")),
            pattern=optional(members, "pattern", Pattern.from_json),
            minimum=optional(members, "minimum", string_reader("Refinements.minimum")),
            maximum=optional(members, "maximum", string_reader("Refinements.maximum")),
            exclusive_minimum=optional(members, "exclusiveMinimum", string_reader("Refinements.exclusiveMinimum")),
            exclusive_maximum=optional(members, "exclusiveMaximum", string_reader("Refinements.exclusiveMaximum")),
            multiple_of=optional(members, "multipleOf", string_reader("Refinements.multipleOf")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        if self.min_length is not None:
            json["minLength"] = self.min_length
        if self.max_length is not None:
            json["maxLength"] = self.max_length
        if self.pattern is not None:
            json["pattern"] = self.pattern.to_json()
        if self.minimum is not None:
            json["minimum"] = self.minimum
        if self.maximum is not None:
            json["maximum"] = self.maximum
        if self.exclusive_minimum is not None:
            json["exclusiveMinimum"] = self.exclusive_minimum
        if self.exclusive_maximum is not None:
            json["exclusiveMaximum"] = self.exclusive_maximum
        if self.multiple_of is not None:
            json["multipleOf"] = self.multiple_of
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RefuseUnknownQuery(UnknownQuery):
    policy: Literal["refuse"] = _dataclass_field(default="refuse", init=False)

    @staticmethod
    def from_json(value: object) -> RefuseUnknownQuery:
        members = read_object(value, "RefuseUnknownQuery")
        expect_tag(members, "policy", "refuse", "RefuseUnknownQuery")
        return RefuseUnknownQuery()

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = self.policy
        return json


class RefusedCredential(StrEnum):
    """What an optional-auth operation does with a refused credential: serve it as anonymous, or answer 401. Must act:
    an unknown value makes the IR invalid for every reader.
    """

    ANONYMOUS = "anonymous"
    REJECT = "reject"


@final
@dataclass(frozen=True, slots=True)
class RefusedCredentialUnknown(UnknownEnumValue):
    """A value of RefusedCredential this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in RefusedCredential:
            raise IrModelError("RefusedCredentialUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RequirementSubject:
    source: ValueSource
    defaulted: bool

    @staticmethod
    def from_json(value: object) -> RequirementSubject:
        members = read_object(value, "RequirementSubject")
        return RequirementSubject(
            source=required(members, "source", "RequirementSubject", ValueSource.from_json),
            defaulted=required(
                members,
                "defaulted",
                "RequirementSubject",
                boolean_reader("RequirementSubject.defaulted"),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["source"] = self.source.to_json()
        json["defaulted"] = self.defaulted
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ResourceSubject(RightSubject):
    kind: Literal["resource"] = _dataclass_field(default="resource", init=False)
    type: Name
    id_schema: TypeUse

    @staticmethod
    def from_json(value: object) -> ResourceSubject:
        members = read_object(value, "ResourceSubject")
        expect_tag(members, "kind", "resource", "ResourceSubject")
        return ResourceSubject(
            type=required(members, "type", "ResourceSubject", Name.from_json),
            id_schema=required(members, "idSchema", "ResourceSubject", TypeUse.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["type"] = self.type.to_json()
        json["idSchema"] = self.id_schema.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Response:
    """A success or derived non-error response."""

    status: int
    media: str | None = None
    """Absent for an empty body."""
    body: TypeUse | None = None
    shape: ResponseShape | ResponseShapeUnknown
    headers: tuple[ResponseHeader, ...]
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None
    docs: Docs | None = None
    """The docs written on the response."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", copy_list(self.headers))

    @staticmethod
    def from_json(value: object) -> Response:
        members = read_object(value, "Response")
        return Response(
            status=required(members, "status", "Response", integer_reader("Response.status")),
            media=optional(members, "media", string_reader("Response.media")),
            body=optional(members, "body", TypeUse.from_json),
            shape=required(
                members,
                "shape",
                "Response",
                open_enum_reader("Response.shape", ResponseShape, ResponseShapeUnknown),
            ),
            headers=required(members, "headers", "Response", list_reader("Response.headers", ResponseHeader.from_json)),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
            docs=optional(members, "docs", Docs.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["status"] = self.status
        if self.media is not None:
            json["media"] = self.media
        if self.body is not None:
            json["body"] = self.body.to_json()
        json["shape"] = encode_open_enum(self.shape)
        json["headers"] = encode_list(self.headers, encode_model)
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ResponseHeader:
    name: str
    type: TypeUse
    required: bool
    semantic: ResponseHeaderSemantic | ResponseHeaderSemanticUnknown | None = None
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None

    @staticmethod
    def from_json(value: object) -> ResponseHeader:
        members = read_object(value, "ResponseHeader")
        return ResponseHeader(
            name=required(members, "name", "ResponseHeader", string_reader("ResponseHeader.name")),
            type=required(members, "type", "ResponseHeader", TypeUse.from_json),
            required=required(members, "required", "ResponseHeader", boolean_reader("ResponseHeader.required")),
            semantic=optional(
                members,
                "semantic",
                open_enum_reader("ResponseHeader.semantic", ResponseHeaderSemantic, ResponseHeaderSemanticUnknown),
            ),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["type"] = self.type.to_json()
        json["required"] = self.required
        if self.semantic is not None:
            json["semantic"] = encode_open_enum(self.semantic)
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


class ResponseHeaderSemantic(StrEnum):
    """What a response header carries: an identity header's semantic (declarations HeaderSemantic) or a deprecation
    header (ADR 0004 section 7).
    """

    DEADLINE = "deadline"
    TRACE_CONTEXT = "traceContext"
    ACTOR_SURFACE = "actorSurface"
    VERSION_TOKEN = "versionToken"
    DEPRECATION = "deprecation"
    SUNSET = "sunset"
    SUCCESSOR_LINK = "successorLink"


@final
@dataclass(frozen=True, slots=True)
class ResponseHeaderSemanticUnknown(UnknownEnumValue):
    """A value of ResponseHeaderSemantic this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ResponseHeaderSemantic:
            raise IrModelError("ResponseHeaderSemanticUnknown: the value is a known one")


class ResponseShape(StrEnum):
    """The format shape of a response; 'binary' and 'redirect' bypass the format (ADR 0004 section 8)."""

    ITEM = "item"
    TABLE = "table"
    LIST = "list"
    PAGE = "page"
    EMPTY = "empty"
    BINARY = "binary"
    REDIRECT = "redirect"


@final
@dataclass(frozen=True, slots=True)
class ResponseShapeUnknown(UnknownEnumValue):
    """A value of ResponseShape this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ResponseShape:
            raise IrModelError("ResponseShapeUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RetryHeader:
    """The retry header of a 429 from a bucket rule (grammar 13, rateLimit)."""

    name: str
    param: str
    """The required member of the code's params holding the delay in integer milliseconds."""
    unit: RetryUnit | RetryUnitUnknown
    derived_from: DerivedFrom

    @staticmethod
    def from_json(value: object) -> RetryHeader:
        members = read_object(value, "RetryHeader")
        return RetryHeader(
            name=required(members, "name", "RetryHeader", string_reader("RetryHeader.name")),
            param=required(members, "param", "RetryHeader", string_reader("RetryHeader.param")),
            unit=required(
                members,
                "unit",
                "RetryHeader",
                open_enum_reader("RetryHeader.unit", RetryUnit, RetryUnitUnknown),
            ),
            derived_from=required(members, "derivedFrom", "RetryHeader", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name
        json["param"] = self.param
        json["unit"] = encode_open_enum(self.unit)
        json["derivedFrom"] = self.derived_from.to_json()
        return json


class RetryUnit(StrEnum):
    """The unit of a retry header; 's' rounds the millisecond delay up."""

    S = "s"
    MS = "ms"


@final
@dataclass(frozen=True, slots=True)
class RetryUnitUnknown(UnknownEnumValue):
    """A value of RetryUnit this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in RetryUnit:
            raise IrModelError("RetryUnitUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Right:
    """A right (ADR 0004 section 4)."""

    id: RightId
    params: SchemaRef | None = None
    subject: RightSubject
    guest: Reason | None = None
    errors: tuple[ErrorCode, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin
    derived_from: DerivedFrom | None = None
    code_name: Name | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Right.extensions"))

    @staticmethod
    def from_json(value: object) -> Right:
        members = read_object(value, "Right")
        return Right(
            id=required(members, "id", "Right", string_reader("Right.id")),
            params=optional(members, "params", string_reader("Right.params")),
            subject=required(members, "subject", "Right", RightSubject.from_json),
            guest=optional(members, "guest", string_reader("Right.guest")),
            errors=required(members, "errors", "Right", list_reader("Right.errors", string_reader("Right.errors[]"))),
            docs=required(members, "docs", "Right", Docs.from_json),
            extensions=required(members, "extensions", "Right", extensions_reader("Right.extensions")),
            origin=required(members, "origin", "Right", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
            code_name=optional(members, "codeName", Name.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        if self.params is not None:
            json["params"] = self.params
        json["subject"] = self.subject.to_json()
        if self.guest is not None:
            json["guest"] = self.guest
        json["errors"] = encode_list(self.errors, encode_plain)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        if self.code_name is not None:
            json["codeName"] = self.code_name.to_json()
        return json


type RightId = str
"""The id of a right: its catalogue key, the name its library uses, without line breaks or leading or trailing space
(ADR 0002 section 4).
"""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RightRequirement(Requirement):
    kind: Literal["right"] = _dataclass_field(default="right", init=False)
    right: RightId
    params: FrozenJson | Omitted = OMITTED
    """Values already validated against the right's params schema."""
    subject: RequirementSubject | None = None
    entry: str | None = None
    """The 'requirements' entry it was written through."""
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.params, Omitted):
            object.__setattr__(self, "params", freeze(self.params, "RightRequirement.params"))

    @staticmethod
    def from_json(value: object) -> RightRequirement:
        members = read_object(value, "RightRequirement")
        expect_tag(members, "kind", "right", "RightRequirement")
        return RightRequirement(
            right=required(members, "right", "RightRequirement", string_reader("RightRequirement.right")),
            params=optional_opaque(members, "params", "RightRequirement.params"),
            subject=optional(members, "subject", RequirementSubject.from_json),
            entry=optional(members, "entry", string_reader("RightRequirement.entry")),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["right"] = self.right
        if not isinstance(self.params, Omitted):
            json["params"] = thaw(self.params)
        if self.subject is not None:
            json["subject"] = self.subject.to_json()
        if self.entry is not None:
            json["entry"] = self.entry
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Rule:
    """A rule (ADR 0004 section 4)."""

    id: RuleId
    params: SchemaRef | None = None
    takes_bucket: bool
    proof: RuleProof | None = None
    errors: tuple[ErrorCode, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Rule.extensions"))

    @staticmethod
    def from_json(value: object) -> Rule:
        members = read_object(value, "Rule")
        return Rule(
            id=required(members, "id", "Rule", string_reader("Rule.id")),
            params=optional(members, "params", string_reader("Rule.params")),
            takes_bucket=required(members, "takesBucket", "Rule", boolean_reader("Rule.takesBucket")),
            proof=optional(members, "proof", RuleProof.from_json),
            errors=required(members, "errors", "Rule", list_reader("Rule.errors", string_reader("Rule.errors[]"))),
            docs=required(members, "docs", "Rule", Docs.from_json),
            extensions=required(members, "extensions", "Rule", extensions_reader("Rule.extensions")),
            origin=required(members, "origin", "Rule", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        if self.params is not None:
            json["params"] = self.params
        json["takesBucket"] = self.takes_bucket
        if self.proof is not None:
            json["proof"] = self.proof.to_json()
        json["errors"] = encode_list(self.errors, encode_plain)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


type RuleId = str
"""The id of a rule: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RuleProof:
    in_: ProofPlacement | ProofPlacementUnknown
    name: str
    schema: TypeUse

    @staticmethod
    def from_json(value: object) -> RuleProof:
        members = read_object(value, "RuleProof")
        return RuleProof(
            in_=required(
                members,
                "in",
                "RuleProof",
                open_enum_reader("RuleProof.in", ProofPlacement, ProofPlacementUnknown),
            ),
            name=required(members, "name", "RuleProof", string_reader("RuleProof.name")),
            schema=required(members, "schema", "RuleProof", TypeUse.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["in"] = encode_open_enum(self.in_)
        json["name"] = self.name
        json["schema"] = self.schema.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class RuleRequirement(Requirement):
    kind: Literal["rule"] = _dataclass_field(default="rule", init=False)
    rule: RuleId
    params: FrozenJson | Omitted = OMITTED
    """Values already validated against the rule's params schema."""
    bucket: BucketId | None = None
    entry: str | None = None
    """The 'requirements' entry it was written through."""
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.params, Omitted):
            object.__setattr__(self, "params", freeze(self.params, "RuleRequirement.params"))

    @staticmethod
    def from_json(value: object) -> RuleRequirement:
        members = read_object(value, "RuleRequirement")
        expect_tag(members, "kind", "rule", "RuleRequirement")
        return RuleRequirement(
            rule=required(members, "rule", "RuleRequirement", string_reader("RuleRequirement.rule")),
            params=optional_opaque(members, "params", "RuleRequirement.params"),
            bucket=optional(members, "bucket", string_reader("RuleRequirement.bucket")),
            entry=optional(members, "entry", string_reader("RuleRequirement.entry")),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["rule"] = self.rule
        if not isinstance(self.params, Omitted):
            json["params"] = thaw(self.params)
        if self.bucket is not None:
            json["bucket"] = self.bucket
        if self.entry is not None:
            json["entry"] = self.entry
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Scalar:
    """A named format of the scalars catalogue: a base type plus refinements (ADR 0003 section 8). Its own type holds no
    'scalar'.
    """

    id: ScalarId
    name: Name
    type: ScalarTypeUse
    directions: tuple[Direction | DirectionUnknown, ...]
    docs: Docs
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "directions", copy_list(self.directions))

    @staticmethod
    def from_json(value: object) -> Scalar:
        members = read_object(value, "Scalar")
        return Scalar(
            id=required(members, "id", "Scalar", string_reader("Scalar.id")),
            name=required(members, "name", "Scalar", Name.from_json),
            type=required(members, "type", "Scalar", ScalarTypeUse.from_json),
            directions=required(
                members,
                "directions",
                "Scalar",
                list_reader("Scalar.directions", open_enum_reader("Scalar.directions[]", Direction, DirectionUnknown)),
            ),
            docs=required(members, "docs", "Scalar", Docs.from_json),
            origin=required(members, "origin", "Scalar", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["name"] = self.name.to_json()
        json["type"] = self.type.to_json()
        json["directions"] = encode_list(self.directions, encode_open_enum)
        json["docs"] = self.docs.to_json()
        json["origin"] = self.origin.to_json()
        return json


type ScalarId = str
"""The id of a named format: its catalogue key (ADR 0003 section 8, ADR 0002 section 4)."""


class ScalarType(StrEnum):
    """The JSON type of a scalar."""

    STRING = "string"
    INTEGER = "integer"
    NUMBER = "number"
    BOOLEAN = "boolean"


@final
@dataclass(frozen=True, slots=True)
class ScalarTypeUnknown(UnknownEnumValue):
    """A value of ScalarType this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ScalarType:
            raise IrModelError("ScalarTypeUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ScalarTypeUse(TypeUse):
    """A scalar use. A use of a named format names it in 'scalar' and holds its type and refinements inline, so a target
    that does not map the named format still checks it (ADR 0003 section 8).
    """

    kind: Literal["scalar"] = _dataclass_field(default="scalar", init=False)
    type: ScalarType | ScalarTypeUnknown
    format: str | None = None
    """A portable format of ADR 0003 section 8 ('uuid', 'int64', 'decimal'...); a named format is 'scalar'."""
    scalar: ScalarId | None = None
    """The named format this use reads, from the scalars catalogue."""
    refinements: Refinements
    content: JsonContent | None = None
    sensitive: bool | None = None
    """The value is secret (ADR 0003 section 6): a use of a declared scalar marked sensitive; absent means false. A
    property's own type use leaves it out: Property.sensitive holds it (invariant ir.property.sensitive). A response
    carrying it is no-store (invariant ir.cache.sensitive-no-store).
    """
    nullable: bool | None = None
    """The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out:
    Property.nullable holds it (invariant ir.property.nullable).
    """
    docs: Docs | None = None
    """The docs written at the position of this use (today the compiler writes them on array items, map keys or values
    and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named
    format hold their own.
    """
    examples: tuple[FrozenJson, ...] | None = None
    """The examples written at the position of this use, placed as its docs are."""

    def __post_init__(self) -> None:
        if self.examples is not None:
            object.__setattr__(self, "examples", copy_list(self.examples))

    @staticmethod
    def from_json(value: object) -> ScalarTypeUse:
        members = read_object(value, "ScalarTypeUse")
        expect_tag(members, "kind", "scalar", "ScalarTypeUse")
        return ScalarTypeUse(
            type=required(
                members,
                "type",
                "ScalarTypeUse",
                open_enum_reader("ScalarTypeUse.type", ScalarType, ScalarTypeUnknown),
            ),
            format=optional(members, "format", string_reader("ScalarTypeUse.format")),
            scalar=optional(members, "scalar", string_reader("ScalarTypeUse.scalar")),
            refinements=required(members, "refinements", "ScalarTypeUse", Refinements.from_json),
            content=optional(members, "content", JsonContent.from_json),
            sensitive=optional(members, "sensitive", boolean_reader("ScalarTypeUse.sensitive")),
            nullable=optional(members, "nullable", boolean_reader("ScalarTypeUse.nullable")),
            docs=optional(members, "docs", Docs.from_json),
            examples=optional(
                members,
                "examples",
                list_reader("ScalarTypeUse.examples", opaque_reader("ScalarTypeUse.examples[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["type"] = encode_open_enum(self.type)
        if self.format is not None:
            json["format"] = self.format
        if self.scalar is not None:
            json["scalar"] = self.scalar
        json["refinements"] = self.refinements.to_json()
        if self.content is not None:
            json["content"] = self.content.to_json()
        if self.sensitive is not None:
            json["sensitive"] = self.sensitive
        if self.nullable is not None:
            json["nullable"] = self.nullable
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        if self.examples is not None:
            json["examples"] = encode_list(self.examples, thaw)
        return json


type SchemaId = str
"""The id of a named schema: its catalogue key, the name as written or the canonical identifier of a derived name (ADR
0004 section 9, ADR 0002 section 4, ADR 0007).
"""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SchemaPrincipal(Principal):
    kind: Literal["schema"] = _dataclass_field(default="schema", init=False)
    schema: SchemaRef

    @staticmethod
    def from_json(value: object) -> SchemaPrincipal:
        members = read_object(value, "SchemaPrincipal")
        expect_tag(members, "kind", "schema", "SchemaPrincipal")
        return SchemaPrincipal(
            schema=required(members, "schema", "SchemaPrincipal", string_reader("SchemaPrincipal.schema")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["schema"] = self.schema
        return json


type SchemaRef = SchemaId
"""A reference by id to a named object, map or union schema of the schemas catalogue (ADR 0004 section 4). An id,
usually a scalar or a named format, is a TypeUse instead.
"""


type SchemeId = str
"""The id of a security scheme: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Scope:
    """A scope (ADR 0004 section 4)."""

    id: ScopeId
    id_schema: TypeUse
    within: ScopeId | None = None
    errors: tuple[ErrorCode, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "Scope.extensions"))

    @staticmethod
    def from_json(value: object) -> Scope:
        members = read_object(value, "Scope")
        return Scope(
            id=required(members, "id", "Scope", string_reader("Scope.id")),
            id_schema=required(members, "idSchema", "Scope", TypeUse.from_json),
            within=optional(members, "within", string_reader("Scope.within")),
            errors=required(members, "errors", "Scope", list_reader("Scope.errors", string_reader("Scope.errors[]"))),
            docs=required(members, "docs", "Scope", Docs.from_json),
            extensions=required(members, "extensions", "Scope", extensions_reader("Scope.extensions")),
            origin=required(members, "origin", "Scope", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["idSchema"] = self.id_schema.to_json()
        if self.within is not None:
            json["within"] = self.within
        json["errors"] = encode_list(self.errors, encode_plain)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


type ScopeId = str
"""The id of a scope: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ScopeSubject(RightSubject):
    kind: Literal["scope"] = _dataclass_field(default="scope", init=False)
    scope: ScopeId

    @staticmethod
    def from_json(value: object) -> ScopeSubject:
        members = read_object(value, "ScopeSubject")
        expect_tag(members, "kind", "scope", "ScopeSubject")
        return ScopeSubject(scope=required(members, "scope", "ScopeSubject", string_reader("ScopeSubject.scope")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["scope"] = self.scope
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Service:
    """An upstream service (ADR 0004 section 4)."""

    id: ServiceId
    maturity: Maturity | MaturityUnknown
    origin: Origin

    @staticmethod
    def from_json(value: object) -> Service:
        members = read_object(value, "Service")
        return Service(
            id=required(members, "id", "Service", string_reader("Service.id")),
            maturity=required(
                members,
                "maturity",
                "Service",
                open_enum_reader("Service.maturity", Maturity, MaturityUnknown),
            ),
            origin=required(members, "origin", "Service", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["maturity"] = encode_open_enum(self.maturity)
        json["origin"] = self.origin.to_json()
        return json


type ServiceId = str
"""The id of a service: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Shape:
    body: Template
    headers: tuple[HeaderTemplate, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", copy_list(self.headers))

    @staticmethod
    def from_json(value: object) -> Shape:
        members = read_object(value, "Shape")
        return Shape(
            body=required(members, "body", "Shape", Template.from_json),
            headers=required(members, "headers", "Shape", list_reader("Shape.headers", HeaderTemplate.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["body"] = self.body.to_json()
        json["headers"] = encode_list(self.headers, encode_model)
        return json


class SignatureEncoding(StrEnum):
    """How a signature is encoded."""

    HEX = "hex"
    BASE64 = "base64"


@final
@dataclass(frozen=True, slots=True)
class SignatureEncodingUnknown(UnknownEnumValue):
    """A value of SignatureEncoding this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in SignatureEncoding:
            raise IrModelError("SignatureEncodingUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SignatureScheme(Scheme):
    """A signed request, verified as 'signature' says."""

    id: SchemeId
    kind: Literal["signature"] = _dataclass_field(default="signature", init=False)
    name: str | None = None
    """The signature header."""
    signature: SignatureVerify
    origin: Origin

    @staticmethod
    def from_json(value: object) -> SignatureScheme:
        members = read_object(value, "SignatureScheme")
        expect_tag(members, "kind", "signature", "SignatureScheme")
        return SignatureScheme(
            id=required(members, "id", "SignatureScheme", string_reader("SignatureScheme.id")),
            name=optional(members, "name", string_reader("SignatureScheme.name")),
            signature=required(members, "signature", "SignatureScheme", SignatureVerify.from_json),
            origin=required(members, "origin", "SignatureScheme", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        if self.name is not None:
            json["name"] = self.name
        json["signature"] = self.signature.to_json()
        json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SignedIdentity(Identity):
    """An identity reached through one signature scheme (ADR 0013)."""

    id: IdentityId
    kind: Literal["signed"] = _dataclass_field(default="signed", init=False)
    signed: SchemeId
    principal: Principal
    unknown_keys: KeysPolicy | None = None
    errors: tuple[ErrorCode, ...]
    headers: tuple[IdentityHeaderUse, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", copy_list(self.errors))
        object.__setattr__(self, "headers", copy_list(self.headers))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "SignedIdentity.extensions"))

    @staticmethod
    def from_json(value: object) -> SignedIdentity:
        members = read_object(value, "SignedIdentity")
        expect_tag(members, "kind", "signed", "SignedIdentity")
        return SignedIdentity(
            id=required(members, "id", "SignedIdentity", string_reader("SignedIdentity.id")),
            signed=required(members, "signed", "SignedIdentity", string_reader("SignedIdentity.signed")),
            principal=required(members, "principal", "SignedIdentity", Principal.from_json),
            unknown_keys=optional(members, "unknownKeys", KeysPolicy.from_json),
            errors=required(
                members,
                "errors",
                "SignedIdentity",
                list_reader("SignedIdentity.errors", string_reader("SignedIdentity.errors[]")),
            ),
            headers=required(
                members,
                "headers",
                "SignedIdentity",
                list_reader("SignedIdentity.headers", IdentityHeaderUse.from_json),
            ),
            docs=required(members, "docs", "SignedIdentity", Docs.from_json),
            extensions=required(
                members,
                "extensions",
                "SignedIdentity",
                extensions_reader("SignedIdentity.extensions"),
            ),
            origin=required(members, "origin", "SignedIdentity", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["kind"] = self.kind
        json["signed"] = self.signed
        json["principal"] = self.principal.to_json()
        if self.unknown_keys is not None:
            json["unknownKeys"] = self.unknown_keys.to_json()
        json["errors"] = encode_list(self.errors, encode_plain)
        json["headers"] = encode_list(self.headers, encode_model)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        return json


type Slot = str
"""A slot of the template language (ADR 0002 sections 13 and 14), without its '$'."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SlotMemberName(MemberName):
    kind: Literal["slot"] = _dataclass_field(default="slot", init=False)
    slot: Slot

    @staticmethod
    def from_json(value: object) -> SlotMemberName:
        members = read_object(value, "SlotMemberName")
        expect_tag(members, "kind", "slot", "SlotMemberName")
        return SlotMemberName(slot=required(members, "slot", "SlotMemberName", string_reader("SlotMemberName.slot")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["slot"] = self.slot
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SlotTemplate(Template):
    kind: Literal["slot"] = _dataclass_field(default="slot", init=False)
    slot: Slot
    path: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", copy_list(self.path))

    @staticmethod
    def from_json(value: object) -> SlotTemplate:
        members = read_object(value, "SlotTemplate")
        expect_tag(members, "kind", "slot", "SlotTemplate")
        return SlotTemplate(
            slot=required(members, "slot", "SlotTemplate", string_reader("SlotTemplate.slot")),
            path=required(
                members,
                "path",
                "SlotTemplate",
                list_reader("SlotTemplate.path", string_reader("SlotTemplate.path[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["slot"] = self.slot
        json["path"] = encode_list(self.path, encode_plain)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SlotTextPart(TextPart):
    kind: Literal["slot"] = _dataclass_field(default="slot", init=False)
    slot: Slot
    path: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", copy_list(self.path))

    @staticmethod
    def from_json(value: object) -> SlotTextPart:
        members = read_object(value, "SlotTextPart")
        expect_tag(members, "kind", "slot", "SlotTextPart")
        return SlotTextPart(
            slot=required(members, "slot", "SlotTextPart", string_reader("SlotTextPart.slot")),
            path=required(
                members,
                "path",
                "SlotTextPart",
                list_reader("SlotTextPart.path", string_reader("SlotTextPart.path[]")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["slot"] = self.slot
        json["path"] = encode_list(self.path, encode_plain)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SortKey:
    key: str
    right: RightId | None = None
    params: FrozenJson | Omitted = OMITTED
    """The params of 'right', validated against the right's params schema; only with 'right' (ADR 0002 section 10)."""
    subject: FieldRightSubject | None = None
    """Where the right's subject is read on the request; only with 'right' (ADR 0003 section 6)."""
    derived_from: DerivedFrom | None = None
    origin: Origin | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.params, Omitted):
            object.__setattr__(self, "params", freeze(self.params, "SortKey.params"))

    @staticmethod
    def from_json(value: object) -> SortKey:
        members = read_object(value, "SortKey")
        return SortKey(
            key=required(members, "key", "SortKey", string_reader("SortKey.key")),
            right=optional(members, "right", string_reader("SortKey.right")),
            params=optional_opaque(members, "params", "SortKey.params"),
            subject=optional(members, "subject", FieldRightSubject.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
            origin=optional(members, "origin", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["key"] = self.key
        if self.right is not None:
            json["right"] = self.right
        if not isinstance(self.params, Omitted):
            json["params"] = thaw(self.params)
        if self.subject is not None:
            json["subject"] = self.subject.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SourceLocation:
    """A location in a source file."""

    file: str
    """Relative to the workspace root, with forward slashes: never absolute, no '.' or '..' segment, no backslash or
    ':'.
    """
    line: int
    column: int
    end_line: int
    end_column: int

    @staticmethod
    def from_json(value: object) -> SourceLocation:
        members = read_object(value, "SourceLocation")
        return SourceLocation(
            file=required(members, "file", "SourceLocation", string_reader("SourceLocation.file")),
            line=required(members, "line", "SourceLocation", integer_reader("SourceLocation.line")),
            column=required(members, "column", "SourceLocation", integer_reader("SourceLocation.column")),
            end_line=required(members, "endLine", "SourceLocation", integer_reader("SourceLocation.endLine")),
            end_column=required(members, "endColumn", "SourceLocation", integer_reader("SourceLocation.endColumn")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["file"] = self.file
        json["line"] = self.line
        json["column"] = self.column
        json["endLine"] = self.end_line
        json["endColumn"] = self.end_column
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SourceMap:
    ir_revision: int
    locations: Mapping[str, SourceLocation]
    """Keyed by '<layer>#<pointer>', the serialised form of an Origin; a 'core' origin has no entry (ADR 0004 section
    11).
    """

    def __post_init__(self) -> None:
        object.__setattr__(self, "locations", copy_map(self.locations))

    @staticmethod
    def from_json(value: object) -> SourceMap:
        members = read_object(value, "SourceMap")
        return SourceMap(
            ir_revision=required(members, "irRevision", "SourceMap", integer_reader("SourceMap.irRevision")),
            locations=required(
                members,
                "locations",
                "SourceMap",
                map_reader("SourceMap.locations", SourceLocation.from_json),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["irRevision"] = self.ir_revision
        json["locations"] = encode_map(self.locations, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SourceSchemeKey(SchemeKey):
    kind: Literal["from"] = _dataclass_field(default="from", init=False)
    from_: ValueSource
    """Where the request carries the key id (path, query or header)."""

    @staticmethod
    def from_json(value: object) -> SourceSchemeKey:
        members = read_object(value, "SourceSchemeKey")
        expect_tag(members, "kind", "from", "SourceSchemeKey")
        return SourceSchemeKey(from_=required(members, "from", "SourceSchemeKey", ValueSource.from_json))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["from"] = self.from_.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class SuccessShapes:
    item: Shape
    table: Shape
    list: Shape
    page: Shape

    @staticmethod
    def from_json(value: object) -> SuccessShapes:
        members = read_object(value, "SuccessShapes")
        return SuccessShapes(
            item=required(members, "item", "SuccessShapes", Shape.from_json),
            table=required(members, "table", "SuccessShapes", Shape.from_json),
            list=required(members, "list", "SuccessShapes", Shape.from_json),
            page=required(members, "page", "SuccessShapes", Shape.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["item"] = self.item.to_json()
        json["table"] = self.table.to_json()
        json["list"] = self.list.to_json()
        json["page"] = self.page.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class Surface:
    name: Name
    prefix: str
    path_version: PathVersionMode | PathVersionModeUnknown
    origin: Origin

    @staticmethod
    def from_json(value: object) -> Surface:
        members = read_object(value, "Surface")
        return Surface(
            name=required(members, "name", "Surface", Name.from_json),
            prefix=required(members, "prefix", "Surface", string_reader("Surface.prefix")),
            path_version=required(
                members,
                "pathVersion",
                "Surface",
                open_enum_reader("Surface.pathVersion", PathVersionMode, PathVersionModeUnknown),
            ),
            origin=required(members, "origin", "Surface", Origin.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["name"] = self.name.to_json()
        json["prefix"] = self.prefix
        json["pathVersion"] = encode_open_enum(self.path_version)
        json["origin"] = self.origin.to_json()
        return json


type SurfaceId = str
"""The id of an api surface: its catalogue key (ADR 0004 section 9, ADR 0002 section 4)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class TemplateSignature(SignatureVerify):
    verify: Literal["template"] = _dataclass_field(default="template", init=False)
    format: str
    algorithm: str
    payload: str
    encoding: SignatureEncoding | SignatureEncodingUnknown
    tolerance_ms: int | None = None
    key: SchemeKey

    @staticmethod
    def from_json(value: object) -> TemplateSignature:
        members = read_object(value, "TemplateSignature")
        expect_tag(members, "verify", "template", "TemplateSignature")
        return TemplateSignature(
            format=required(members, "format", "TemplateSignature", string_reader("TemplateSignature.format")),
            algorithm=required(members, "algorithm", "TemplateSignature", string_reader("TemplateSignature.algorithm")),
            payload=required(members, "payload", "TemplateSignature", string_reader("TemplateSignature.payload")),
            encoding=required(
                members,
                "encoding",
                "TemplateSignature",
                open_enum_reader("TemplateSignature.encoding", SignatureEncoding, SignatureEncodingUnknown),
            ),
            tolerance_ms=optional(members, "toleranceMs", integer_reader("TemplateSignature.toleranceMs")),
            key=required(members, "key", "TemplateSignature", SchemeKey.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["verify"] = self.verify
        json["format"] = self.format
        json["algorithm"] = self.algorithm
        json["payload"] = self.payload
        json["encoding"] = encode_open_enum(self.encoding)
        if self.tolerance_ms is not None:
            json["toleranceMs"] = self.tolerance_ms
        json["key"] = self.key.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class TextTemplate(Template):
    kind: Literal["text"] = _dataclass_field(default="text", init=False)
    parts: tuple[TextPart, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "parts", copy_list(self.parts))

    @staticmethod
    def from_json(value: object) -> TextTemplate:
        members = read_object(value, "TextTemplate")
        expect_tag(members, "kind", "text", "TextTemplate")
        return TextTemplate(
            parts=required(members, "parts", "TextTemplate", list_reader("TextTemplate.parts", TextPart.from_json)),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["parts"] = encode_list(self.parts, encode_model)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class UnionSchema(Schema):
    kind: Literal["union"] = _dataclass_field(default="union", init=False)
    tag: UnionTag
    variants: tuple[UnionVariant, ...]
    id: SchemaId
    name: Name
    type_name: str | None = None
    directions: tuple[Direction | DirectionUnknown, ...]
    examples: tuple[FrozenJson, ...]
    docs: Docs
    extensions: Extensions
    origin: Origin
    deprecated: bool | None = None
    """The schema is deprecated (ADR 0003 section 1); absent means false."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "variants", copy_list(self.variants))
        object.__setattr__(self, "directions", copy_list(self.directions))
        object.__setattr__(self, "examples", copy_list(self.examples))
        object.__setattr__(self, "extensions", freeze_extensions(self.extensions, "UnionSchema.extensions"))

    @staticmethod
    def from_json(value: object) -> UnionSchema:
        members = read_object(value, "UnionSchema")
        expect_tag(members, "kind", "union", "UnionSchema")
        return UnionSchema(
            tag=required(members, "tag", "UnionSchema", UnionTag.from_json),
            variants=required(
                members,
                "variants",
                "UnionSchema",
                list_reader("UnionSchema.variants", UnionVariant.from_json),
            ),
            id=required(members, "id", "UnionSchema", string_reader("UnionSchema.id")),
            name=required(members, "name", "UnionSchema", Name.from_json),
            type_name=optional(members, "typeName", string_reader("UnionSchema.typeName")),
            directions=required(
                members,
                "directions",
                "UnionSchema",
                list_reader(
                    "UnionSchema.directions",
                    open_enum_reader("UnionSchema.directions[]", Direction, DirectionUnknown),
                ),
            ),
            examples=required(
                members,
                "examples",
                "UnionSchema",
                list_reader("UnionSchema.examples", opaque_reader("UnionSchema.examples[]")),
            ),
            docs=required(members, "docs", "UnionSchema", Docs.from_json),
            extensions=required(members, "extensions", "UnionSchema", extensions_reader("UnionSchema.extensions")),
            origin=required(members, "origin", "UnionSchema", Origin.from_json),
            deprecated=optional(members, "deprecated", boolean_reader("UnionSchema.deprecated")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["tag"] = self.tag.to_json()
        json["variants"] = encode_list(self.variants, encode_model)
        json["id"] = self.id
        json["name"] = self.name.to_json()
        if self.type_name is not None:
            json["typeName"] = self.type_name
        json["directions"] = encode_list(self.directions, encode_open_enum)
        json["examples"] = encode_list(self.examples, thaw)
        json["docs"] = self.docs.to_json()
        json["extensions"] = thaw_extensions(self.extensions)
        json["origin"] = self.origin.to_json()
        if self.deprecated is not None:
            json["deprecated"] = self.deprecated
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class UnionVariant:
    tag: str
    schema: SchemaId
    docs: Docs | None = None
    """The docs written on the variant itself, beside its schema reference."""

    @staticmethod
    def from_json(value: object) -> UnionVariant:
        members = read_object(value, "UnionVariant")
        return UnionVariant(
            tag=required(members, "tag", "UnionVariant", string_reader("UnionVariant.tag")),
            schema=required(members, "schema", "UnionVariant", string_reader("UnionVariant.schema")),
            docs=optional(members, "docs", Docs.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["tag"] = self.tag
        json["schema"] = self.schema
        if self.docs is not None:
            json["docs"] = self.docs.to_json()
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class UnknownKeys:
    """Unknown keys of an input use (ADR 0003 section 4)."""

    policy: UnknownKeysPolicy | UnknownKeysPolicyUnknown
    reason: Reason | None = None
    origin: Origin | None = None
    derived_from: DerivedFrom | None = None

    @staticmethod
    def from_json(value: object) -> UnknownKeys:
        members = read_object(value, "UnknownKeys")
        return UnknownKeys(
            policy=required(
                members,
                "policy",
                "UnknownKeys",
                open_enum_reader("UnknownKeys.policy", UnknownKeysPolicy, UnknownKeysPolicyUnknown),
            ),
            reason=optional(members, "reason", string_reader("UnknownKeys.reason")),
            origin=optional(members, "origin", Origin.from_json),
            derived_from=optional(members, "derivedFrom", DerivedFrom.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["policy"] = encode_open_enum(self.policy)
        if self.reason is not None:
            json["reason"] = self.reason
        if self.origin is not None:
            json["origin"] = self.origin.to_json()
        if self.derived_from is not None:
            json["derivedFrom"] = self.derived_from.to_json()
        return json


class UnknownKeysPolicy(StrEnum):
    """What an input use does with unknown keys (ADR 0003 section 4). Must act: an unknown value makes the IR invalid
    for every reader.
    """

    REFUSE = "refuse"
    IGNORE = "ignore"
    KEEP = "keep"


@final
@dataclass(frozen=True, slots=True)
class UnknownKeysPolicyUnknown(UnknownEnumValue):
    """A value of UnknownKeysPolicy this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in UnknownKeysPolicy:
            raise IrModelError("UnknownKeysPolicyUnknown: the value is a known one")


class UrlForm(StrEnum):
    """Whether a URL a target writes is a relative reference, or absolute from one configured public origin."""

    RELATIVE = "relative"
    ABSOLUTE = "absolute"


@final
@dataclass(frozen=True, slots=True)
class UrlFormUnknown(UnknownEnumValue):
    """A value of UrlForm this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in UrlForm:
            raise IrModelError("UrlFormUnknown: the value is a known one")


class UrlRole(StrEnum):
    SELF = "self"
    FIRST = "first"
    PREVIOUS = "previous"
    NEXT = "next"
    LAST = "last"


@final
@dataclass(frozen=True, slots=True)
class UrlRoleUnknown(UnknownEnumValue):
    """A value of UrlRole this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in UrlRole:
            raise IrModelError("UrlRoleUnknown: the value is a known one")


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ValueSchemeKey(SchemeKey):
    kind: Literal["value"] = _dataclass_field(default="value", init=False)
    value: str
    """The key id the application looks its secret up by; never the secret."""

    @staticmethod
    def from_json(value: object) -> ValueSchemeKey:
        members = read_object(value, "ValueSchemeKey")
        expect_tag(members, "kind", "value", "ValueSchemeKey")
        return ValueSchemeKey(value=required(members, "value", "ValueSchemeKey", string_reader("ValueSchemeKey.value")))

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["value"] = self.value
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class ValueSource:
    """Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal, scope and
    holderField (the holder's property); no other member with host, subdomain and resolver; 'prefixBits' only with
    address (invariants ir.value-source.members and ir.value-source.place).
    """

    in_: ValueSourceIn | ValueSourceInUnknown
    name: str | None = None
    prefix_bits: int | None = None

    @staticmethod
    def from_json(value: object) -> ValueSource:
        members = read_object(value, "ValueSource")
        return ValueSource(
            in_=required(
                members,
                "in",
                "ValueSource",
                open_enum_reader("ValueSource.in", ValueSourceIn, ValueSourceInUnknown),
            ),
            name=optional(members, "name", string_reader("ValueSource.name")),
            prefix_bits=optional(members, "prefixBits", integer_reader("ValueSource.prefixBits")),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["in"] = encode_open_enum(self.in_)
        if self.name is not None:
            json["name"] = self.name
        if self.prefix_bits is not None:
            json["prefixBits"] = self.prefix_bits
        return json


class ValueSourceIn(StrEnum):
    """Where a value is read (ADR 0002 section 4); 'resolver' only as a scope source, 'holderField' only as a field
    right's subject source. Must act: an unknown value makes the IR invalid for every reader.
    """

    PATH = "path"
    QUERY = "query"
    HEADER = "header"
    BODY = "body"
    PRINCIPAL = "principal"
    SCOPE = "scope"
    HOST = "host"
    SUBDOMAIN = "subdomain"
    ADDRESS = "address"
    RESOLVER = "resolver"
    HOLDER_FIELD = "holderField"


@final
@dataclass(frozen=True, slots=True)
class ValueSourceInUnknown(UnknownEnumValue):
    """A value of ValueSourceIn this IR revision does not know, kept raw."""

    def __post_init__(self) -> None:
        if self.raw in ValueSourceIn:
            raise IrModelError("ValueSourceInUnknown: the value is a known one")


type VariantId = str
"""The id of a principal variant: its catalogue key (ADR 0004 section 9)."""


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class VariantsPrincipal(Principal):
    kind: Literal["variants"] = _dataclass_field(default="variants", init=False)
    variants: Mapping[str, SchemaRef]

    def __post_init__(self) -> None:
        object.__setattr__(self, "variants", copy_map(self.variants))

    @staticmethod
    def from_json(value: object) -> VariantsPrincipal:
        members = read_object(value, "VariantsPrincipal")
        expect_tag(members, "kind", "variants", "VariantsPrincipal")
        return VariantsPrincipal(
            variants=required(
                members,
                "variants",
                "VariantsPrincipal",
                map_reader("VariantsPrincipal.variants", string_reader("VariantsPrincipal.variants{}")),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["variants"] = encode_map(self.variants, encode_plain)
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class VocabularyEnumSource(EnumSource):
    kind: Literal["vocabulary"] = _dataclass_field(default="vocabulary", init=False)
    vocabulary: str

    @staticmethod
    def from_json(value: object) -> VocabularyEnumSource:
        members = read_object(value, "VocabularyEnumSource")
        expect_tag(members, "kind", "vocabulary", "VocabularyEnumSource")
        return VocabularyEnumSource(
            vocabulary=required(
                members,
                "vocabulary",
                "VocabularyEnumSource",
                string_reader("VocabularyEnumSource.vocabulary"),
            ),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["kind"] = self.kind
        json["vocabulary"] = self.vocabulary
        return json


@final
@dataclass(frozen=True, slots=True, kw_only=True)
class WireFormat:
    """A wire format (A30, ADR 0008)."""

    id: FormatId
    origin: Origin
    media: str
    absent: Absent | AbsentUnknown
    success: SuccessShapes
    meta: Mapping[str, MetaMember]
    error: ErrorShape

    def __post_init__(self) -> None:
        object.__setattr__(self, "meta", copy_map(self.meta))

    @staticmethod
    def from_json(value: object) -> WireFormat:
        members = read_object(value, "WireFormat")
        return WireFormat(
            id=required(members, "id", "WireFormat", string_reader("WireFormat.id")),
            origin=required(members, "origin", "WireFormat", Origin.from_json),
            media=required(members, "media", "WireFormat", string_reader("WireFormat.media")),
            absent=required(
                members,
                "absent",
                "WireFormat",
                open_enum_reader("WireFormat.absent", Absent, AbsentUnknown),
            ),
            success=required(members, "success", "WireFormat", SuccessShapes.from_json),
            meta=required(members, "meta", "WireFormat", map_reader("WireFormat.meta", MetaMember.from_json)),
            error=required(members, "error", "WireFormat", ErrorShape.from_json),
        )

    def to_json(self) -> dict[str, JsonValue]:
        json: dict[str, JsonValue] = {}
        json["id"] = self.id
        json["origin"] = self.origin.to_json()
        json["media"] = self.media
        json["absent"] = encode_open_enum(self.absent)
        json["success"] = self.success.to_json()
        json["meta"] = encode_map(self.meta, encode_model)
        json["error"] = self.error.to_json()
        return json
