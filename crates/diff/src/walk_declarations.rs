//! The declaration catalogues (errors, natures, schemes, headers, identities, rights, rules, scopes,
//! buckets, services, extension keys, formats and paging styles) the walk compares entry by entry.

use seampact_diff_table::IrDefinition;
use seampact_json::{JsonObject, JsonValue};

use crate::DiffError;
use crate::change_sink::ElementOrigin;
use crate::not_ported::not_ported_yet;
use crate::walk_context::WalkContext;

/// A declaration catalogue of the IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum DeclarationCatalogue {
    Errors,
    Natures,
    Schemes,
    Headers,
    Identities,
    Rights,
    Rules,
    Scopes,
    Buckets,
    Services,
    ExtensionKeys,
    Formats,
    Pagings,
}

impl DeclarationCatalogue {
    /// Every catalogue, in the order the TypeScript lists them.
    pub(crate) const ALL: [Self; 13] = [
        Self::Errors,
        Self::Natures,
        Self::Schemes,
        Self::Headers,
        Self::Identities,
        Self::Rights,
        Self::Rules,
        Self::Scopes,
        Self::Buckets,
        Self::Services,
        Self::ExtensionKeys,
        Self::Formats,
        Self::Pagings,
    ];

    /// The IR member holding the catalogue.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Errors => "errors",
            Self::Natures => "natures",
            Self::Schemes => "schemes",
            Self::Headers => "headers",
            Self::Identities => "identities",
            Self::Rights => "rights",
            Self::Rules => "rules",
            Self::Scopes => "scopes",
            Self::Buckets => "buckets",
            Self::Services => "services",
            Self::ExtensionKeys => "extensionKeys",
            Self::Formats => "formats",
            Self::Pagings => "pagings",
        }
    }

    /// The catalogue named `name`, if it is one.
    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|catalogue| catalogue.as_str() == name)
    }
}

/// Compares the entries of one catalogue.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_declarations(
    _context: &mut WalkContext<'_>,
    _catalogue: DeclarationCatalogue,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareDeclarations"))
}

/// The `layer` of the origin of an entry, when the entry and its origin are objects.
pub(crate) fn origin_of(entry: Option<&JsonValue>) -> Option<ElementOrigin> {
    let JsonValue::Object(members) = entry? else {
        return None;
    };
    let Some(JsonValue::Object(origin)) = members.get("origin") else {
        return None;
    };

    match origin.get("layer") {
        Some(JsonValue::String(layer)) => Some(ElementOrigin {
            layer: layer.clone(),
        }),
        _ => None,
    }
}

/// The IR definition of an entry of `catalogue`: by its `kind` for schemes and identities. `None`
/// when the kind is none the catalogue lists: the member rows then name the catalogue itself.
pub(crate) fn definition_of(
    catalogue: DeclarationCatalogue,
    entry: &JsonObject,
) -> Option<IrDefinition> {
    let kind = match entry.get("kind") {
        Some(JsonValue::String(kind)) => Some(kind.as_str()),
        _ => None,
    };

    match catalogue {
        DeclarationCatalogue::Errors => Some(IrDefinition::ErrorDecl),
        DeclarationCatalogue::Natures => Some(IrDefinition::NatureDecl),
        DeclarationCatalogue::Headers => Some(IrDefinition::HeaderDecl),
        DeclarationCatalogue::Rights => Some(IrDefinition::Right),
        DeclarationCatalogue::Rules => Some(IrDefinition::Rule),
        DeclarationCatalogue::Scopes => Some(IrDefinition::Scope),
        DeclarationCatalogue::Buckets => Some(IrDefinition::Bucket),
        DeclarationCatalogue::Services => Some(IrDefinition::Service),
        DeclarationCatalogue::ExtensionKeys => Some(IrDefinition::ExtensionKeyDecl),
        DeclarationCatalogue::Formats => Some(IrDefinition::WireFormat),
        DeclarationCatalogue::Pagings => Some(IrDefinition::PagingStyle),
        DeclarationCatalogue::Schemes => match kind? {
            "cookie" => Some(IrDefinition::CookieScheme),
            "header" => Some(IrDefinition::HeaderScheme),
            "query" => Some(IrDefinition::QueryScheme),
            "bearer" => Some(IrDefinition::BearerScheme),
            "basic" => Some(IrDefinition::BasicScheme),
            "signature" => Some(IrDefinition::SignatureScheme),
            _ => None,
        },
        DeclarationCatalogue::Identities => match kind? {
            "credential" => Some(IrDefinition::CredentialIdentity),
            "signed" => Some(IrDefinition::SignedIdentity),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(text: &str) -> JsonValue {
        seampact_json::JsonValue::try_from(
            serde_json::from_str::<serde_json::Value>(text)
                .unwrap_or_else(|error| panic!("{text}: {error}")),
        )
        .unwrap_or_else(|error| panic!("{text}: {error}"))
    }

    #[test]
    fn only_an_object_origin_with_a_text_layer_is_an_origin() {
        let layer = |text: &str| origin_of(Some(&object(text))).map(|origin| origin.layer);

        assert_eq!(
            layer(r#"{"origin":{"layer":"pack:audit"}}"#),
            Some("pack:audit".to_owned())
        );
        assert_eq!(layer(r#"{"origin":{"layer":4}}"#), None);
        assert_eq!(layer(r#"{"origin":[]}"#), None);
        assert_eq!(layer(r"[]"), None);
        assert_eq!(origin_of(None), None);
    }

    #[test]
    fn a_scheme_or_identity_takes_its_definition_from_its_kind() {
        let entry = |text: &str| match object(text) {
            JsonValue::Object(members) => members,
            other => panic!("{other:?}"),
        };

        assert_eq!(
            definition_of(
                DeclarationCatalogue::Schemes,
                &entry(r#"{"kind":"cookie"}"#)
            ),
            Some(IrDefinition::CookieScheme)
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Identities,
                &entry(r#"{"kind":"signed"}"#)
            ),
            Some(IrDefinition::SignedIdentity)
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Schemes,
                &entry(r#"{"kind":"unheard"}"#)
            ),
            None
        );
        assert_eq!(
            definition_of(DeclarationCatalogue::Schemes, &entry(r#"{"kind":7}"#)),
            None
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Errors,
                &entry(r#"{"kind":"unheard"}"#)
            ),
            Some(IrDefinition::ErrorDecl)
        );
    }
}
