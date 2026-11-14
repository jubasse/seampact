//! The `identities` catalogue (ADR 0002 section 9, ADR 0013): credential identities with their
//! read, write and optional-read schemes, signed identities with their one signature scheme and
//! unknown-key policy, each with its principal, errors as written, and its uses of the headers
//! catalogue checked against their declarations.

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    CredentialIdentity, CredentialSchemes, Docs, ErrorCode, HeaderId, HeaderSemantic, HeaderUseFor,
    IdentityHeaderUse, IdentityId, IgnoreKeysPolicy, IrMap, KeepKeysPolicy, KeysPolicy,
    KnownIdentity, KnownKeysPolicy, KnownPrincipal, KnownPrincipalRef, Reason, Schema, SchemaId,
    SchemeId, SignedIdentity, TypeUse, ValueSource,
};
use seampact_js::cmp_utf16;
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::headers::{AccessIdentityHeader, access_identity_actor_surface_refusal};
use crate::principal::{
    AccessIdentityPrincipalResult, access_identity_principal, access_identity_principal_field,
    access_identity_principal_field_refusal,
};
use crate::read::{
    access_identity_boolean, access_identity_entries, access_identity_member,
    access_identity_object, access_identity_string, access_identity_strings,
};
use crate::report::{
    AccessIdentityProblem, AccessIdentityRelated, AccessIdentityReporter, AccessIdentityRule,
};
use crate::schema_use::access_identity_schema_use;
use crate::schemes::scheme_kind_text;
use crate::source::access_identity_value_source;

/// The scheme lists of a credential identity, in the order they are read.
pub(crate) const CREDENTIAL_LISTS: &[&str] = &["read", "write", "optionalRead"];

/// ADR 0002 section 11: `all` is the default of an identity header's `for`. A versionToken's
/// request header still goes on writes only, whatever `for` says: identity.versionToken (ADR 0006
/// section 5) is the specific rule.
pub(crate) const DEFAULT_HEADER_USE_FOR: HeaderUseFor = HeaderUseFor::All;

/// What the identities read besides the raw tree: the scheme kinds as written and the built
/// header catalogue.
pub(crate) struct AccessIdentityCatalogues<'built> {
    /// Each written scheme's `kind`, also for a scheme left out of the catalogue for an error.
    pub(crate) scheme_kinds: &'built HashMap<String, Option<String>>,
    pub(crate) headers: &'built IndexMap<String, AccessIdentityHeader>,
    pub(crate) schemas: &'built IrMap<SchemaId, Schema>,
}

/// One written identity and what its checks read.
pub(crate) struct IdentityEntry<'entry, 'half, 'run> {
    pub(crate) id: &'entry str,
    pub(crate) pointer: String,
    pub(crate) raw: &'entry JsonObject,
    pub(crate) catalogues: &'entry AccessIdentityCatalogues<'entry>,
    pub(crate) schemas: &'entry dyn TreeSchemaService,
    pub(crate) reporter: &'entry mut AccessIdentityReporter<'half, 'run>,
}

/// The members a signed identity takes from its raw form.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SignedMembers {
    pub(crate) signed: SchemeId,
    pub(crate) unknown_keys: Option<KeysPolicy>,
}

/// The members a header use takes from a `versionToken` declaration.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct VersionTokenMembers {
    pub(crate) from: Option<ValueSource>,
    pub(crate) stale: Option<ErrorCode>,
}

/// What the kind of an identity adds to the members every identity has.
enum KindMembers {
    Credential(CredentialSchemes),
    Signed(SignedMembers),
}

/// The identities of the api, by id, in written order; an identity with an error is left out.
pub(crate) fn access_identity_identities(
    catalogues: &AccessIdentityCatalogues<'_>,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<IrMap<IdentityId, KnownIdentity>, PassError> {
    let raw = reporter.raw();
    let mut identities = IrMap::new();

    for (id, written) in access_identity_entries(&raw.merged, "identities") {
        let pointer = pointer_below("", &["identities", id]);
        let before = reporter.errors();
        let entry = IdentityEntry {
            id,
            pointer,
            raw: written,
            catalogues,
            schemas,
            reporter: &mut *reporter,
        };
        let identity = identity_of(entry)?;

        if let Some(identity) = identity
            && reporter.errors() == before
        {
            identities.insert(IdentityId::new(id.to_owned()), identity);
        }
    }

    Ok(identities)
}

fn identity_of(mut entry: IdentityEntry<'_, '_, '_>) -> Result<Option<KnownIdentity>, PassError> {
    let origin = entry.reporter.origin(&entry.pointer).ok_or_else(|| {
        InternalError::new(format!("the identity at {} has no origin", entry.pointer))
    })?;
    let raw = entry.raw;
    let signed = access_identity_string(raw, "kind") == Some("signed");
    let kind_members = if signed {
        signed_members(&mut entry)?.map(KindMembers::Signed)
    } else {
        credential_members(&mut entry)?.map(KindMembers::Credential)
    };

    let Some(written_principal) = access_identity_member(raw, "principal") else {
        let message = format!("identity '{}' has no 'principal'", entry.id);

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::IdentityMember,
            message,
            fix: "Name the principal schema the authenticate hook answers, or 'variants: { <name>: <schema> }'.".to_owned(),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    let principal = access_identity_principal(
        entry.id,
        &entry.pointer,
        written_principal,
        entry.schemas,
        entry.reporter,
    )?;
    let AccessIdentityPrincipalResult::Resolved(principal) = principal else {
        return Ok(None);
    };

    let headers = header_uses(&mut entry, &principal)?;

    let (Some(kind_members), Some(headers)) = (kind_members, headers) else {
        return Ok(None);
    };

    let id = IdentityId::new(entry.id.to_owned());
    let errors = access_identity_strings(raw, "errors")
        .unwrap_or_default()
        .into_iter()
        .map(ErrorCode::new)
        .collect();
    let docs = docs_of(raw);

    Ok(Some(match kind_members {
        KindMembers::Credential(schemes) => KnownIdentity::Credential(CredentialIdentity {
            id,
            schemes,
            principal: principal.into(),
            errors,
            headers,
            docs,
            extensions: IrMap::new(),
            origin,
        }),
        KindMembers::Signed(members) => KnownIdentity::Signed(SignedIdentity {
            id,
            signed: members.signed,
            principal: principal.into(),
            unknown_keys: members.unknown_keys,
            errors,
            headers,
            docs,
            extensions: IrMap::new(),
            origin,
        }),
    }))
}

fn docs_of(raw: &JsonObject) -> Docs {
    Docs {
        summary: access_identity_string(raw, "summary").map(str::to_owned),
        description: access_identity_string(raw, "description").map(str::to_owned),
    }
}

pub(crate) fn credential_members(
    entry: &mut IdentityEntry<'_, '_, '_>,
) -> Result<Option<CredentialSchemes>, InternalError> {
    let raw = entry.raw;
    let Some(schemes) = access_identity_object(raw, "schemes") else {
        let message = format!("credential identity '{}' has no 'schemes'", entry.id);

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::IdentityMember,
            message,
            fix: "List the schemes accepted on reads and on writes, as 'schemes: { read: [...], write: [...] }', or set 'kind: signed' and name its 'scheme'.".to_owned(),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    let before = entry.reporter.errors();
    let mut lists: Vec<Vec<SchemeId>> = Vec::new();

    for list in CREDENTIAL_LISTS {
        let names = access_identity_strings(schemes, list).unwrap_or_default();

        for (index, name) in names.iter().enumerate() {
            let scheme_pointer =
                pointer_below(&entry.pointer, &["schemes", list, &index.to_string()]);
            let first = names.iter().position(|candidate| candidate == name);

            if first.is_some_and(|first| first < index) {
                report_repeated_scheme(entry, name, list, &scheme_pointer)?;
            } else {
                check_credential_scheme(entry, name, &scheme_pointer)?;
            }
        }

        // ADR 0004 section 9: an identity's scheme lists are sorted.
        let mut sorted = names;

        sorted.sort_by(|left, right| cmp_utf16(left, right));
        lists.push(sorted.into_iter().map(SchemeId::new).collect());
    }

    if entry.reporter.errors() > before {
        return Ok(None);
    }

    let mut lists = lists.into_iter();

    Ok(Some(CredentialSchemes {
        read: lists.next().unwrap_or_default(),
        write: lists.next().unwrap_or_default(),
        optional_read: lists.next().unwrap_or_default(),
    }))
}

// Neither the authoring nor the IR schema sets `uniqueItems` on a scheme list.
fn report_repeated_scheme(
    entry: &mut IdentityEntry<'_, '_, '_>,
    name: &str,
    list: &str,
    pointer: &str,
) -> Result<(), InternalError> {
    let message = format!(
        "identity '{}' lists scheme '{name}' twice in '{list}'",
        entry.id
    );

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SchemeReference,
        message,
        fix: "List each scheme once.".to_owned(),
        pointer: pointer.to_owned(),
        related: Vec::new(),
    })
}

fn check_credential_scheme(
    entry: &mut IdentityEntry<'_, '_, '_>,
    name: &str,
    pointer: &str,
) -> Result<(), InternalError> {
    let kinds = entry.catalogues.scheme_kinds;
    let id = entry.id;

    let Some(kind) = kinds.get(name) else {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SchemeReference,
            message: format!("identity '{id}' names scheme '{name}', which is not declared"),
            fix: "Declare the scheme under 'schemes', or name a declared one.".to_owned(),
            pointer: pointer.to_owned(),
            related: Vec::new(),
        })?;

        return Ok(());
    };

    if kind.as_deref() != Some("signature") {
        return Ok(());
    }

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SchemeKind,
        message: format!("credential identity '{id}' names signature scheme '{name}'"),
        fix: "Declare a signed identity for the signature scheme: 'kind: signed' and 'scheme: <name>' (ADR 0013).".to_owned(),
        pointer: pointer.to_owned(),
        related: Vec::new(),
    })?;

    Ok(())
}

fn signed_members(
    entry: &mut IdentityEntry<'_, '_, '_>,
) -> Result<Option<SignedMembers>, InternalError> {
    let raw = entry.raw;
    let scheme = access_identity_string(raw, "scheme");
    let kinds = entry.catalogues.scheme_kinds;
    let id = entry.id;

    let Some(scheme) = scheme else {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::IdentityMember,
            message: format!("signed identity '{id}' has no 'scheme'"),
            fix: "Name the one signature scheme its requests are signed with: 'scheme: <name>'."
                .to_owned(),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    let scheme_pointer = pointer_below(&entry.pointer, &["scheme"]);

    if kinds.get(scheme).and_then(Option::as_deref) != Some("signature") {
        let declared = kinds.contains_key(scheme);
        let (rule, message) = if declared {
            (
                AccessIdentityRule::SchemeKind,
                format!(
                    "signed identity '{id}' names {} scheme '{scheme}'; a signed identity takes a signature scheme",
                    scheme_kind_text(kinds, scheme)
                ),
            )
        } else {
            (
                AccessIdentityRule::SchemeReference,
                format!("signed identity '{id}' names scheme '{scheme}', which is not declared"),
            )
        };

        entry.reporter.error(AccessIdentityProblem {
            rule,
            message,
            fix: "Name a scheme of 'kind: signature' (ADR 0013), or make the identity a credential one.".to_owned(),
            pointer: scheme_pointer,
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    Ok(Some(SignedMembers {
        signed: SchemeId::new(scheme.to_owned()),
        unknown_keys: keys_policy(raw)?,
    }))
}

// The authoring schema writes exactly one of `ignore` and `keep`, each with its reason.
fn keys_policy(raw: &JsonObject) -> Result<Option<KeysPolicy>, InternalError> {
    let Some(written) = access_identity_object(raw, "unknownKeys") else {
        return Ok(None);
    };

    if let Some(reason) = access_identity_string(written, "ignore") {
        return Ok(Some(
            KnownKeysPolicy::Ignore(IgnoreKeysPolicy {
                reason: Reason::new(reason.to_owned()),
            })
            .into(),
        ));
    }

    if let Some(reason) = access_identity_string(written, "keep") {
        return Ok(Some(
            KnownKeysPolicy::Keep(KeepKeysPolicy {
                reason: Reason::new(reason.to_owned()),
            })
            .into(),
        ));
    }

    Err(InternalError::new(
        "an identity's unknownKeys holds neither 'ignore' nor 'keep'",
    ))
}

fn header_uses(
    entry: &mut IdentityEntry<'_, '_, '_>,
    principal: &KnownPrincipal,
) -> Result<Option<Vec<IdentityHeaderUse>>, PassError> {
    let before = entry.reporter.errors();
    let raw = entry.raw;
    let mut uses = Vec::new();

    for (header, written) in access_identity_entries(raw, "headers") {
        let pointer = pointer_below(&entry.pointer, &["headers", header]);

        if let Some(used) = header_use(entry, principal, header, &pointer, written)? {
            uses.push(used);
        }
    }

    if entry.reporter.errors() > before {
        return Ok(None);
    }

    Ok(Some(uses))
}

fn header_use(
    entry: &mut IdentityEntry<'_, '_, '_>,
    principal: &KnownPrincipal,
    header: &str,
    pointer: &str,
    raw: &JsonObject,
) -> Result<Option<IdentityHeaderUse>, PassError> {
    let catalogue_headers = entry.catalogues.headers;

    let Some(declared) = catalogue_headers.get(header) else {
        // A declaration with an error of its own is left out of the catalogue and already
        // reported.
        let written = access_identity_object(&entry.reporter.raw().merged, "headers");

        if !written.is_some_and(|headers| headers.contains_key(header)) {
            let message = format!(
                "identity '{}' uses header '{header}', which is not declared",
                entry.id
            );

            entry.reporter.error(AccessIdentityProblem {
                rule: AccessIdentityRule::HeaderUse,
                message,
                fix: "Declare the header under 'headers' with its name and semantic, or use a declared one.".to_owned(),
                pointer: pointer.to_owned(),
                related: Vec::new(),
            })?;
        }

        return Ok(None);
    };

    let origin = entry
        .reporter
        .origin(pointer)
        .ok_or_else(|| InternalError::new(format!("the header use at {pointer} has no origin")))?;
    let before = entry.reporter.errors();
    let schema = use_schema(entry, declared, header, pointer, raw)?;
    let token_members = version_token_members(entry, principal, declared, header, pointer, raw)?;

    if entry.reporter.errors() > before {
        return Ok(None);
    }

    let Some(token_members) = token_members else {
        return Ok(None);
    };

    let use_for = access_identity_string(raw, "for")
        .and_then(HeaderUseFor::known)
        .unwrap_or(DEFAULT_HEADER_USE_FOR);

    Ok(Some(IdentityHeaderUse {
        header: HeaderId::new(header.to_owned()),
        r#for: use_for,
        required: access_identity_boolean(raw, "required").unwrap_or(false),
        schema,
        from: token_members.from,
        stale: token_members.stale,
        origin,
    }))
}

// ADR 0002 section 9: a use sets `schema` only when the declaration has none; an actorSurface
// needs one.
fn use_schema(
    entry: &mut IdentityEntry<'_, '_, '_>,
    declared: &AccessIdentityHeader,
    header: &str,
    pointer: &str,
    raw: &JsonObject,
) -> Result<Option<TypeUse>, PassError> {
    let schema_pointer = pointer_below(pointer, &["schema"]);
    let written = access_identity_member(raw, "schema").is_some();

    if written && declared.schema_written {
        let message = format!(
            "identity '{}' sets a schema on header '{header}', whose declaration already has one",
            entry.id
        );

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::HeaderUse,
            message,
            fix: "Set the schema in one place: remove it from the use, or from the declaration."
                .to_owned(),
            pointer: schema_pointer,
            related: vec![AccessIdentityRelated {
                pointer: pointer_below(&declared.pointer, &["schema"]),
                message: "the declaration's schema".to_owned(),
            }],
        })?;

        return Ok(None);
    }

    let actor_surface = declared.declaration.semantic == HeaderSemantic::ActorSurface;

    if actor_surface && !written && !declared.schema_written {
        let message = format!(
            "actorSurface header '{header}' has no schema in its declaration or in identity '{}'",
            entry.id
        );

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::HeaderUse,
            message,
            fix: "Name the enum of the product's surfaces, as 'schema: { enum: Surface }', on the declaration or the use.".to_owned(),
            pointer: pointer.to_owned(),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    if !written {
        return Ok(None);
    }

    let schema = access_identity_schema_use(entry.schemas, &schema_pointer, &declared.direction)?;

    if actor_surface && !matches!(schema, TypeUse::Enum(_)) {
        entry.reporter.error(access_identity_actor_surface_refusal(
            AccessIdentityRule::HeaderUse,
            header,
            &schema_pointer,
            schema.tag(),
        ))?;

        return Ok(None);
    }

    Ok(Some(schema))
}

// ADR 0002 section 9: a versionToken use names the principal field it carries (`from`) and the
// code answered to a stale request header (`stale`); no other use takes either.
fn version_token_members(
    entry: &mut IdentityEntry<'_, '_, '_>,
    principal: &KnownPrincipal,
    declared: &AccessIdentityHeader,
    header: &str,
    pointer: &str,
    raw: &JsonObject,
) -> Result<Option<VersionTokenMembers>, PassError> {
    let from = access_identity_string(raw, "from");
    let stale = access_identity_string(raw, "stale");
    let semantic = &declared.declaration.semantic;

    if *semantic != HeaderSemantic::VersionToken {
        let mut written = Vec::new();

        if from.is_some() {
            written.push("'from'");
        }

        if stale.is_some() {
            written.push("'stale'");
        }

        if written.is_empty() {
            return Ok(Some(VersionTokenMembers::default()));
        }

        let message = format!(
            "identity '{}' sets {} on {semantic} header '{header}'",
            entry.id,
            written.join(" and ")
        );

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::HeaderUse,
            message,
            fix: "Remove them: only a versionToken use names the principal field it carries and its stale code.".to_owned(),
            pointer: pointer.to_owned(),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let (Some(from), Some(stale)) = (from, stale) else {
        let missing = if from.is_none() { "'from'" } else { "'stale'" };
        let message = format!(
            "identity '{}' uses versionToken header '{header}' without {missing}",
            entry.id
        );

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::HeaderUse,
            message,
            fix: "Name the principal field the token carries, 'from: principal.<field>', and the code a stale request header answers, 'stale: <code>'.".to_owned(),
            pointer: pointer.to_owned(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    let source = access_identity_value_source(from)?;
    let field = source.name.as_deref().unwrap_or("");
    let fault = access_identity_principal_field(
        entry.catalogues.schemas,
        KnownPrincipalRef::from(principal),
        field,
    )?;

    if let Some(fault) = fault {
        let reader = format!("identity '{}' reads header '{header}' from", entry.id);
        let refusal = access_identity_principal_field_refusal(
            &reader,
            field,
            KnownPrincipalRef::from(principal),
            &fault,
        );

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::PrincipalField,
            message: refusal.message,
            fix: refusal.fix,
            pointer: pointer_below(pointer, &["from"]),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    Ok(Some(VersionTokenMembers {
        from: Some(source),
        stale: Some(ErrorCode::new(stale.to_owned())),
    }))
}
