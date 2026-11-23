//! What a provider's `describe` tells its consumers: the exports of each kind it writes.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::{LinkKind, LinkStyle};

/// A generated export a descriptor points at; `module` is a POSIX path relative to the provider's
/// output root, without extension.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRef {
    /// The module path, without extension.
    pub module: String,
    /// The export name.
    pub export: String,
}

/// One export per direction a schema is used in (its `directions` in the IR).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchemaExports {
    /// The export for the `input` direction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<ExportRef>,
    /// The export for the `output` direction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<ExportRef>,
}

/// What a validators provider writes (ADR 0009 "The provider seam").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidatorsDescriptor {
    /// `standard-schema` or `class-validator`.
    pub style: LinkStyle,
    /// The exports of each schema, by schema id.
    pub schemas: IndexMap<String, SchemaExports>,
    /// The exports of each operation, by operation id.
    pub operations: IndexMap<String, OperationValidatorExports>,
}

/// The validator of a whole request, `{ path, query, headers, body }` after query decoding.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationValidatorExports {
    /// The request validator.
    pub input: ExportRef,
}

/// What the types provider writes: each export is a TypeScript type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypesDescriptor {
    /// `typescript`.
    pub style: LinkStyle,
    /// The exports of each schema, by schema id.
    pub schemas: IndexMap<String, SchemaExports>,
    /// The exports of each operation, by operation id.
    pub operations: IndexMap<String, OperationTypeExports>,
}

/// The request, answer and error types of an operation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationTypeExports {
    /// The request value the validators' `input` accepts.
    pub input: ExportRef,
    /// The answer.
    pub output: ExportRef,
    /// The declared errors.
    pub errors: ExportRef,
}

/// How a client hands back a declared error or an unexpected answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientErrorStyle {
    /// As a result the caller checks.
    Result,
    /// Thrown as the client's `ContractError`.
    Throw,
}

/// What a client provider writes: its public exports, its error style and each operation's method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientDescriptor {
    /// `fetch`.
    pub style: LinkStyle,
    /// How errors come back.
    pub error_style: ClientErrorStyle,
    /// The client's public exports.
    pub exports: ClientExports,
    /// The method of each operation, by operation id.
    pub operations: IndexMap<String, ClientOperationExports>,
}

/// The public exports of a generated client.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[expect(non_snake_case, reason = "the members are the exported names the descriptor writes")]
pub struct ClientExports {
    /// The client factory.
    pub createClient: ExportRef,
    /// The client type.
    pub Client: ExportRef,
    /// The error class.
    pub ContractError: ExportRef,
    /// The per-call options type.
    pub CallOptions: ExportRef,
}

/// The member of `Client` that calls an operation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientOperationExports {
    /// The method name.
    pub method: String,
}

/// One descriptor, tagged by its kind as the TypeScript's `kind` member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Descriptor {
    /// A validators descriptor.
    Validators(ValidatorsDescriptor),
    /// A types descriptor.
    Types(TypesDescriptor),
    /// A client descriptor.
    Client(ClientDescriptor),
}

impl Descriptor {
    /// The kind the descriptor says it is.
    #[must_use]
    pub const fn kind(&self) -> LinkKind {
        match self {
            Self::Validators(_) => LinkKind::Validators,
            Self::Types(_) => LinkKind::Types,
            Self::Client(_) => LinkKind::Client,
        }
    }

    /// The style the descriptor says it writes.
    #[must_use]
    pub const fn style(&self) -> LinkStyle {
        match self {
            Self::Validators(descriptor) => descriptor.style,
            Self::Types(descriptor) => descriptor.style,
            Self::Client(descriptor) => descriptor.style,
        }
    }
}

/// What a provider's `describe` returns, one optional descriptor per kind, keyed as the app
/// config's `link` is.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DescriptorSet {
    /// The validators descriptor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validators: Option<Descriptor>,
    /// The types descriptor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<Descriptor>,
    /// The client descriptor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<Descriptor>,
}

impl DescriptorSet {
    /// The descriptor of `kind`, if the provider gave one.
    #[must_use]
    pub const fn of(&self, kind: LinkKind) -> Option<&Descriptor> {
        match kind {
            LinkKind::Validators => self.validators.as_ref(),
            LinkKind::Types => self.types.as_ref(),
            LinkKind::Client => self.client.as_ref(),
        }
    }
}
