//! The declaration catalogues (errors, natures, schemes, headers, identities, rights, rules, scopes,
//! buckets, services, extension keys, formats and paging styles) the walk compares entry by entry.

use std::collections::HashMap;

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{
    ContractIr, Identity, IdentityHeaderUse, KnownIdentityRef, KnownPrincipalRef, Principal,
    Reason, SchemaRef, TypeUse,
};
use seampact_json::{JsonObject, JsonValue};

use crate::DiffError;
use crate::change_sink::{ChangeReach, ElementOrigin, NO_POSITION, RawChange};
use crate::walk_context::{
    ChangeSite, MemberComparisons, MemberDefinition, WalkContext, compare_members, emit_at,
};
use crate::walk_json::{
    is_same_json, json_of, member_names, object_members, pointer_join, text_value,
};
use crate::walk_reach::{common_reaches, declaration_reach_key};
use crate::walk_type_use::{BoundSide, compare_bound, compare_schema_ref, compare_type_use};

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
}

/// The entries of one catalogue of an IR, as the JSON the TypeScript walk reads.
fn catalogue_entries(
    ir: &ContractIr,
    catalogue: DeclarationCatalogue,
) -> Result<JsonObject, DiffError> {
    match catalogue {
        DeclarationCatalogue::Errors => object_members(&ir.errors),
        DeclarationCatalogue::Natures => object_members(&ir.natures),
        DeclarationCatalogue::Schemes => object_members(&ir.schemes),
        DeclarationCatalogue::Headers => object_members(&ir.headers),
        DeclarationCatalogue::Identities => object_members(&ir.identities),
        DeclarationCatalogue::Rights => object_members(&ir.rights),
        DeclarationCatalogue::Rules => object_members(&ir.rules),
        DeclarationCatalogue::Scopes => object_members(&ir.scopes),
        DeclarationCatalogue::Buckets => object_members(&ir.buckets),
        DeclarationCatalogue::Services => object_members(&ir.services),
        DeclarationCatalogue::ExtensionKeys => object_members(&ir.extension_keys),
        DeclarationCatalogue::Formats => object_members(&ir.formats),
        DeclarationCatalogue::Pagings => object_members(&ir.pagings),
    }
}

/// The members of an entry that is an object.
fn record_of(entry: Option<&JsonValue>) -> Option<&JsonObject> {
    match entry? {
        JsonValue::Object(members) => Some(members),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::String(_)
        | JsonValue::Array(_) => None,
    }
}

/// Whether the entries of the catalogue have a definition each, by their kind.
const fn is_tagged_catalogue(catalogue: DeclarationCatalogue) -> bool {
    matches!(
        catalogue,
        DeclarationCatalogue::Schemes | DeclarationCatalogue::Identities
    )
}

/// Compares the entries of one catalogue: an entry both IRs hold member by member, at the
/// operations reaching it in both; an entry added or removed as a `declaration` at no position.
pub(crate) fn compare_declarations(
    context: &mut WalkContext<'_>,
    catalogue: DeclarationCatalogue,
) -> Result<(), DiffError> {
    let (before_ir, after_ir) = (context.before, context.after);
    let before_entries = catalogue_entries(before_ir, catalogue)?;
    let after_entries = catalogue_entries(after_ir, catalogue)?;

    for id in member_names(Some(&before_entries), Some(&after_entries)) {
        let before_entry = before_entries.get(id);
        let after_entry = after_entries.get(id);
        let pointer = pointer_join("", &[catalogue.as_str(), id]);
        let (Some(before_members), Some(after_members)) =
            (record_of(before_entry), record_of(after_entry))
        else {
            let after_present = record_of(after_entry).is_some();
            let site = ChangeSite {
                reaches: &NO_POSITION,
                origin: origin_of(after_entry.or(before_entry)),
            };

            emit_at(
                context,
                &site,
                RawChange::new(
                    DiffKind::Declaration,
                    if after_present { "added" } else { "removed" },
                    pointer,
                )
                .between(
                    record_of(before_entry).map(|_| text_value(id)),
                    after_present.then(|| text_value(id)),
                ),
            );

            continue;
        };
        let reaches = common_reaches(
            &context.before_reach,
            &context.after_reach,
            &declaration_reach_key(catalogue.as_str(), id),
        );
        let site = ChangeSite {
            reaches: &reaches,
            origin: origin_of(after_entry),
        };
        let definition = definition_of(catalogue, after_members);

        // A tagged entry of another kind holds other members: the kind change says it all.
        if is_tagged_catalogue(catalogue) && before_members.get("kind") != after_members.get("kind")
        {
            compare_members(
                context,
                &site,
                definition,
                &pointer,
                Some(&kind_only(before_members)),
                Some(&kind_only(after_members)),
                &MemberComparisons::new(),
            )?;

            continue;
        }

        let comparisons = entry_comparisons(before_ir, after_ir, &site, catalogue, id);

        compare_members(
            context,
            &site,
            definition,
            &pointer,
            Some(before_members),
            Some(after_members),
            &comparisons,
        )?;
    }

    Ok(())
}

/// An object holding only the `kind` of `members`, when it has one.
fn kind_only(members: &JsonObject) -> JsonObject {
    let mut kind_members = JsonObject::new();

    if let Some(kind) = members.get("kind") {
        kind_members.insert("kind".to_owned(), kind.clone());
    }

    kind_members
}

/// The comparisons of the members of one catalogue entry that have one of their own.
fn entry_comparisons<'comparison>(
    before: &'comparison ContractIr,
    after: &'comparison ContractIr,
    site: &'comparison ChangeSite<'_>,
    catalogue: DeclarationCatalogue,
    id: &str,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();

    match catalogue {
        DeclarationCatalogue::Errors => insert_schema_ref_comparison(
            &mut comparisons,
            site,
            before
                .errors
                .get(id)
                .and_then(|entry| entry.params.as_ref()),
            after.errors.get(id).and_then(|entry| entry.params.as_ref()),
        ),
        DeclarationCatalogue::Rights => {
            let (before_right, after_right) = (before.rights.get(id), after.rights.get(id));

            insert_schema_ref_comparison(
                &mut comparisons,
                site,
                before_right.and_then(|entry| entry.params.as_ref()),
                after_right.and_then(|entry| entry.params.as_ref()),
            );
            comparisons.insert(
                "guest",
                Box::new(move |context, pointer, _before_value, _after_value| {
                    compare_guest(
                        context,
                        site,
                        pointer,
                        before_right.and_then(|entry| entry.guest.as_ref()),
                        after_right.and_then(|entry| entry.guest.as_ref()),
                    );

                    Ok(())
                }),
            );
        }
        DeclarationCatalogue::Rules => insert_schema_ref_comparison(
            &mut comparisons,
            site,
            before.rules.get(id).and_then(|entry| entry.params.as_ref()),
            after.rules.get(id).and_then(|entry| entry.params.as_ref()),
        ),
        DeclarationCatalogue::Headers => insert_header_schema_comparison(
            &mut comparisons,
            site,
            before
                .headers
                .get(id)
                .and_then(|entry| entry.schema.as_ref()),
            after
                .headers
                .get(id)
                .and_then(|entry| entry.schema.as_ref()),
        ),
        DeclarationCatalogue::Scopes => {
            if let (Some(before_scope), Some(after_scope)) =
                (before.scopes.get(id), after.scopes.get(id))
            {
                comparisons.insert(
                    "idSchema",
                    Box::new(move |context, pointer, _before_value, _after_value| {
                        compare_type_use(
                            context,
                            site,
                            pointer,
                            &before_scope.id_schema,
                            &after_scope.id_schema,
                        )
                    }),
                );
            }
        }
        DeclarationCatalogue::Buckets => insert_bucket_comparisons(&mut comparisons, site),
        DeclarationCatalogue::Identities => {
            comparisons.extend(identity_comparisons(
                site,
                before.identities.get(id),
                after.identities.get(id),
            ));
        }
        DeclarationCatalogue::Pagings => comparisons.extend(paging_style_comparisons(site)),
        DeclarationCatalogue::Natures
        | DeclarationCatalogue::Schemes
        | DeclarationCatalogue::Services
        | DeclarationCatalogue::ExtensionKeys
        | DeclarationCatalogue::Formats => {}
    }

    comparisons
}

fn insert_schema_ref_comparison<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'_>,
    before: Option<&'comparison SchemaRef>,
    after: Option<&'comparison SchemaRef>,
) {
    comparisons.insert(
        "params",
        Box::new(move |context, pointer, _before_value, _after_value| {
            compare_schema_ref(context, site, pointer, before, after)
        }),
    );
}

fn insert_header_schema_comparison<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'_>,
    before: Option<&'comparison TypeUse>,
    after: Option<&'comparison TypeUse>,
) {
    comparisons.insert(
        "schema",
        Box::new(move |context, pointer, _before_value, _after_value| {
            let (Some(before_schema), Some(after_schema)) = (before, after) else {
                emit_at(
                    context,
                    site,
                    RawChange::new(DiffKind::TypeChanged, "kind", pointer.to_owned()),
                );

                return Ok(());
            };

            compare_type_use(context, site, pointer, before_schema, after_schema)
        }),
    );
}

fn insert_bucket_comparisons<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'_>,
) {
    comparisons.insert(
        "limit",
        Box::new(|context, pointer, before_value, after_value| {
            compare_bound(
                context,
                site,
                pointer,
                BoundSide::Upper,
                before_value,
                after_value,
            )
        }),
    );
    // A longer window under the same limit admits fewer requests.
    comparisons.insert(
        "windowMs",
        Box::new(|context, pointer, before_value, after_value| {
            compare_bound(
                context,
                site,
                pointer,
                BoundSide::Lower,
                before_value,
                after_value,
            )
        }),
    );
}

/// The positions a paging style member is read at, besides `none`.
const REQUEST_POSITIONS: [DiffPosition; 2] = [DiffPosition::Input, DiffPosition::None];
const RESPONSE_POSITIONS: [DiffPosition; 2] = [DiffPosition::Output, DiffPosition::None];

fn paging_style_comparisons<'comparison>(
    site: &'comparison ChangeSite<'_>,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();
    let members = [
        ("request", REQUEST_POSITIONS),
        ("response", RESPONSE_POSITIONS),
        ("absent", RESPONSE_POSITIONS),
        ("handlerResult", RESPONSE_POSITIONS),
    ];

    for (member, positions) in members {
        comparisons.insert(
            member,
            Box::new(move |context, pointer, before_value, after_value| {
                let reaches: Vec<ChangeReach> = site
                    .reaches
                    .iter()
                    .filter(|reach| positions.contains(&reach.position))
                    .cloned()
                    .collect();
                let position_site = ChangeSite {
                    reaches: &reaches,
                    origin: site.origin.clone(),
                };

                emit_at(
                    context,
                    &position_site,
                    RawChange::new(DiffKind::PagingStyle, member, pointer.to_owned())
                        .between(before_value.cloned(), after_value.cloned()),
                );

                Ok(())
            }),
        );
    }

    comparisons
}

/// The comparisons of an identity's schemes, principal and headers; none when an identity is
/// missing on a side or is of a kind this revision does not know.
fn identity_comparisons<'comparison>(
    site: &'comparison ChangeSite<'_>,
    before: Option<&'comparison Identity>,
    after: Option<&'comparison Identity>,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();
    let (Some(before), Some(after)) = (before, after) else {
        return comparisons;
    };
    let (Ok(before_known), Ok(after_known)) = (
        KnownIdentityRef::try_from(before),
        KnownIdentityRef::try_from(after),
    ) else {
        return comparisons;
    };

    comparisons.insert(
        "schemes",
        Box::new(move |context, pointer, _before_value, _after_value| {
            compare_scheme_lists(
                context,
                site,
                pointer,
                &credential_schemes(before_known),
                &credential_schemes(after_known),
                &scheme_roles(before_known),
                &scheme_roles(after_known),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "principal",
        Box::new(move |context, pointer, _before_value, _after_value| {
            compare_principal(
                context,
                site,
                pointer,
                principal_of(before_known),
                principal_of(after_known),
            )
        }),
    );
    comparisons.insert(
        "headers",
        Box::new(move |context, pointer, _before_value, _after_value| {
            compare_identity_headers(
                context,
                site,
                pointer,
                headers_of(before_known),
                headers_of(after_known),
            )
        }),
    );

    comparisons
}

fn principal_of(identity: KnownIdentityRef<'_>) -> &Principal {
    match identity {
        KnownIdentityRef::Credential(credential) => &credential.principal,
        KnownIdentityRef::Signed(signed) => &signed.principal,
    }
}

fn headers_of(identity: KnownIdentityRef<'_>) -> &[IdentityHeaderUse] {
    match identity {
        KnownIdentityRef::Credential(credential) => &credential.headers,
        KnownIdentityRef::Signed(signed) => &signed.headers,
    }
}

/// The schemes a credential identity reads, writes or optionally reads, each once; none for
/// another kind of identity.
fn credential_schemes(identity: KnownIdentityRef<'_>) -> Vec<String> {
    let KnownIdentityRef::Credential(credential) = identity else {
        return Vec::new();
    };
    let schemes = &credential.schemes;
    let mut distinct: Vec<String> = Vec::new();

    for scheme in schemes
        .read
        .iter()
        .chain(&schemes.write)
        .chain(&schemes.optional_read)
    {
        if !distinct.iter().any(|seen| seen == scheme.as_str()) {
            distinct.push(scheme.as_str().to_owned());
        }
    }

    distinct
}

/// The roles each scheme of a credential identity holds, as a comma-joined list.
fn scheme_roles(identity: KnownIdentityRef<'_>) -> HashMap<String, String> {
    let KnownIdentityRef::Credential(credential) = identity else {
        return HashMap::new();
    };
    let schemes = &credential.schemes;
    let mut roles: HashMap<String, Vec<&str>> = HashMap::new();

    for (role, role_schemes) in [
        ("read", &schemes.read),
        ("write", &schemes.write),
        ("optionalRead", &schemes.optional_read),
    ] {
        for scheme in role_schemes {
            roles
                .entry(scheme.as_str().to_owned())
                .or_default()
                .push(role);
        }
    }

    roles
        .into_iter()
        .map(|(scheme, held)| (scheme, held.join(",")))
        .collect()
}

/// Reports the schemes an identity gained or lost, and a kept scheme that changed roles.
fn compare_scheme_lists(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[String],
    after: &[String],
    before_roles: &HashMap<String, String>,
    after_roles: &HashMap<String, String>,
) {
    for scheme in after.iter().filter(|scheme| !before.contains(scheme)) {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::Identity, "schemeAdded", pointer.to_owned())
                .between(None, Some(text_value(scheme))),
        );
    }

    for scheme in before.iter().filter(|scheme| !after.contains(scheme)) {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::Identity, "schemeRemoved", pointer.to_owned())
                .between(Some(text_value(scheme)), None),
        );
    }

    // A scheme kept but moved between read, write and optional read: which requests it admits changed.
    let moved = after.iter().any(|scheme| {
        before_roles.contains_key(scheme) && before_roles.get(scheme) != after_roles.get(scheme)
    });

    if moved {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::Identity, "schemeRoles", pointer.to_owned()),
        );
    }
}

/// Compares the guest reason of two rights: a guest added or removed moves the right, any other
/// change of the reason is an annotation.
fn compare_guest(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&Reason>,
    after: Option<&Reason>,
) {
    let change = match (before, after) {
        (Some(_), None) => RawChange::new(DiffKind::Right, "guestRemoved", pointer.to_owned()),
        (None, Some(_)) => RawChange::new(DiffKind::Right, "guestAdded", pointer.to_owned()),
        (Some(_), Some(_)) | (None, None) => {
            RawChange::new(DiffKind::Annotation, "guest", pointer.to_owned())
        }
    };

    emit_at(context, site, change);
}

/// Compares the principals of two identities: two schema principals by their schema, any other
/// pair is an identity change.
fn compare_principal(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Principal,
    after: &Principal,
) -> Result<(), DiffError> {
    if let (
        Ok(KnownPrincipalRef::Schema(before_schema)),
        Ok(KnownPrincipalRef::Schema(after_schema)),
    ) = (
        KnownPrincipalRef::try_from(before),
        KnownPrincipalRef::try_from(after),
    ) {
        return compare_schema_ref(
            context,
            site,
            &pointer_join(pointer, &["schema"]),
            Some(&before_schema.schema),
            Some(&after_schema.schema),
        );
    }

    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Identity, "principal", pointer.to_owned()),
    );

    Ok(())
}

/// Compares the headers two identities use: a header added or removed, or one whose use changed.
fn compare_identity_headers(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[IdentityHeaderUse],
    after: &[IdentityHeaderUse],
) -> Result<(), DiffError> {
    for (index, header) in after.iter().enumerate() {
        if before
            .iter()
            .any(|candidate| candidate.header == header.header)
        {
            continue;
        }

        let case_name = if header.required {
            "headerAddedRequired"
        } else {
            "headerAddedOptional"
        };

        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::Identity,
                case_name,
                pointer_join(pointer, &[&index.to_string()]),
            )
            .between(None, Some(text_value(header.header.as_str()))),
        );
    }

    for (index, header) in before.iter().enumerate() {
        let Some((kept, after_header)) = after
            .iter()
            .position(|candidate| candidate.header == header.header)
            .and_then(|kept| after.get(kept).map(|found| (kept, found)))
        else {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::Identity,
                    "headerRemoved",
                    pointer_join(pointer, &[&index.to_string()]),
                )
                .between(Some(text_value(header.header.as_str())), None),
            );

            continue;
        };
        let (before_use, after_use) = (json_of(header)?, json_of(after_header)?);

        if is_same_json(Some(&before_use), Some(&after_use)) {
            continue;
        }

        let origin_only = is_same_json(
            Some(&without_origin(before_use)),
            Some(&without_origin(after_use)),
        );
        let (kind, case_name) = if origin_only {
            (DiffKind::Annotation, "origin")
        } else {
            (DiffKind::Identity, "headerChanged")
        };

        emit_at(
            context,
            site,
            RawChange::new(kind, case_name, pointer_join(pointer, &[&kept.to_string()]))
                .between(None, Some(text_value(after_header.header.as_str()))),
        );
    }

    Ok(())
}

/// The value without its `origin` member, when it is an object.
fn without_origin(mut value: JsonValue) -> JsonValue {
    if let JsonValue::Object(members) = &mut value {
        members.remove("origin");
    }

    value
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

/// The definition of an entry of `catalogue`: by its `kind` for schemes and identities. A kind of
/// another revision lists none: the catalogue then names its members.
pub(crate) fn definition_of(
    catalogue: DeclarationCatalogue,
    entry: &JsonObject,
) -> MemberDefinition {
    let kind = match entry.get("kind") {
        Some(JsonValue::String(kind)) => Some(kind.as_str()),
        _ => None,
    };
    let listed = match catalogue {
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
        DeclarationCatalogue::Schemes => match kind {
            Some("cookie") => Some(IrDefinition::CookieScheme),
            Some("header") => Some(IrDefinition::HeaderScheme),
            Some("query") => Some(IrDefinition::QueryScheme),
            Some("bearer") => Some(IrDefinition::BearerScheme),
            Some("basic") => Some(IrDefinition::BasicScheme),
            Some("signature") => Some(IrDefinition::SignatureScheme),
            _ => None,
        },
        DeclarationCatalogue::Identities => match kind {
            Some("credential") => Some(IrDefinition::CredentialIdentity),
            Some("signed") => Some(IrDefinition::SignedIdentity),
            _ => None,
        },
    };

    listed.map_or(
        MemberDefinition::Catalogue(catalogue.as_str()),
        MemberDefinition::Table,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample_ir::sample_ir;
    use crate::test_walk::{changes_of, ir_value};

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
            MemberDefinition::Table(IrDefinition::CookieScheme)
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Identities,
                &entry(r#"{"kind":"signed"}"#)
            ),
            MemberDefinition::Table(IrDefinition::SignedIdentity)
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Schemes,
                &entry(r#"{"kind":"unheard"}"#)
            ),
            MemberDefinition::Catalogue("schemes")
        );
        assert_eq!(
            definition_of(DeclarationCatalogue::Schemes, &entry(r#"{"kind":7}"#)),
            MemberDefinition::Catalogue("schemes")
        );
        assert_eq!(
            definition_of(
                DeclarationCatalogue::Errors,
                &entry(r#"{"kind":"unheard"}"#)
            ),
            MemberDefinition::Table(IrDefinition::ErrorDecl)
        );
    }

    fn declaration_changes(
        walk: impl FnOnce(&mut WalkContext<'_>, &ChangeSite<'_>) -> Result<(), DiffError>,
    ) -> Vec<String> {
        let ir = sample_ir();

        changes_of(&ir, &ir, walk).unwrap_or_else(|error| panic!("{error}"))
    }

    fn reason() -> Reason {
        ir_value(serde_json::json!("A guest may read."))
    }

    #[test]
    fn a_guest_added_or_removed_moves_the_right_and_a_changed_one_is_an_annotation() {
        let (first, second) = (reason(), ir_value(serde_json::json!("Another reason.")));

        for (before, after, expected) in [
            (None, Some(&first), "Right:guestAdded@/guest"),
            (Some(&first), None, "Right:guestRemoved@/guest"),
            (Some(&first), Some(&second), "Annotation:guest@/guest"),
        ] {
            assert_eq!(
                declaration_changes(|context, site| {
                    compare_guest(context, site, "/guest", before, after);

                    Ok(())
                }),
                vec![expected.to_owned()],
            );
        }
    }

    fn principal(json: serde_json::Value) -> Principal {
        ir_value(json)
    }

    #[test]
    fn two_schema_principals_compare_their_schema_and_any_other_pair_is_an_identity_change() {
        let schema_of = |id: &str| principal(serde_json::json!({"kind": "schema", "schema": id}));
        let variants = principal(serde_json::json!({"kind": "variants", "variants": {}}));

        assert_eq!(
            declaration_changes(|context, site| compare_principal(
                context,
                site,
                "/principal",
                &schema_of("Event"),
                &schema_of("Absent"),
            )),
            vec!["TypeChanged:ref@/principal/schema".to_owned()],
        );
        assert_eq!(
            declaration_changes(|context, site| compare_principal(
                context,
                site,
                "/principal",
                &schema_of("Event"),
                &variants,
            )),
            vec!["Identity:principal@/principal".to_owned()],
        );
    }

    fn header(name: &str, required: bool, layer: &str) -> IdentityHeaderUse {
        ir_value(serde_json::json!({
            "header": name,
            "for": "all",
            "required": required,
            "origin": {"layer": layer, "pointer": "/identities/a/headers/0"},
        }))
    }

    #[test]
    fn identity_headers_are_added_removed_or_changed_by_header_name() {
        let before = [header("X-Kept", true, "api"), header("X-Gone", true, "api")];
        let after = [
            header("X-New", true, "api"),
            header("X-Kept", false, "api"),
            header("X-Opt", false, "api"),
        ];

        assert_eq!(
            declaration_changes(|context, site| compare_identity_headers(
                context, site, "/headers", &before, &after,
            )),
            vec![
                "Identity:headerAddedRequired@/headers/0".to_owned(),
                "Identity:headerChanged@/headers/1".to_owned(),
                "Identity:headerRemoved@/headers/1".to_owned(),
                "Identity:headerAddedOptional@/headers/2".to_owned(),
            ],
        );
    }

    #[test]
    fn a_header_that_moves_only_its_origin_is_an_annotation() {
        let (before, after) = (
            [header("X-A", true, "api")],
            [header("X-A", true, "shared")],
        );

        assert_eq!(
            declaration_changes(|context, site| compare_identity_headers(
                context, site, "/headers", &before, &after,
            )),
            vec!["Annotation:origin@/headers/0".to_owned()],
        );
    }
}
