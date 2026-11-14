//! The `identities` catalogue (ADR 0002 section 9, ADR 0013): credential identities with their
//! read, write and optional-read schemes, signed identities with their one signature scheme and
//! unknown-key policy, each with its principal, errors as written, and its uses of the headers
//! catalogue checked against their declarations.

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_ir::{
    CredentialSchemes, Docs, HeaderUseFor, Identity, IdentityHeaderUse, IdentityId, IrMap,
    KeysPolicy, Principal, Schema, SchemaId, SchemeId, TypeUse,
};
use seampact_js::cmp_utf16;
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, TreeSchemaService, pointer_below};

use crate::headers::AccessIdentityHeader;
use crate::not_ported::not_ported_yet;
use crate::read::{
    access_identity_entries, access_identity_object, access_identity_string,
    access_identity_strings,
};
use crate::report::{AccessIdentityProblem, AccessIdentityReporter, AccessIdentityRule};

/// The scheme lists of a credential identity, in the order they are read.
pub(crate) const CREDENTIAL_LISTS: &[&str] = &["read", "write", "optionalRead"];

/// The values of a header use's `for`.
pub(crate) const HEADER_USE_FOR: &[&str] = &["all", "reads", "writes"];

/// ADR 0002 section 11: `all` is the default of an identity header's `for`. A versionToken's
/// request header still goes on writes only, whatever `for` says: identity.versionToken (ADR 0006
/// section 5) is the specific rule.
pub(crate) const DEFAULT_HEADER_USE_FOR: HeaderUseFor = HeaderUseFor::All;

pub(crate) fn is_header_use_for(text: Option<&str>) -> bool {
    text.is_some_and(|value| HEADER_USE_FOR.contains(&value))
}

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
    pub(crate) from: Option<seampact_ir::ValueSource>,
    pub(crate) stale: Option<seampact_ir::ErrorCode>,
}

/// The identities of the api, by id, in written order; an identity with an error is left out.
pub(crate) fn access_identity_identities(
    catalogues: &AccessIdentityCatalogues<'_>,
    schemas: &dyn TreeSchemaService,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<IrMap<IdentityId, Identity>, PassError> {
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

fn identity_of(_entry: IdentityEntry<'_, '_, '_>) -> Result<Option<Identity>, PassError> {
    Err(not_ported_yet("identityOf"))
}

fn docs_of(raw: &JsonObject) -> Docs {
    Docs {
        summary: access_identity_string(raw, "summary").map(str::to_owned),
        description: access_identity_string(raw, "description").map(str::to_owned),
    }
}

fn credential_members(
    entry: &mut IdentityEntry<'_, '_, '_>,
) -> Result<Option<CredentialSchemes>, PassError> {
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
    _entry: &mut IdentityEntry<'_, '_, '_>,
    _name: &str,
    _list: &str,
    _pointer: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRepeatedScheme"))
}

fn check_credential_scheme(
    entry: &mut IdentityEntry<'_, '_, '_>,
    name: &str,
    pointer: &str,
) -> Result<(), PassError> {
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
    _entry: &mut IdentityEntry<'_, '_, '_>,
) -> Result<Option<SignedMembers>, PassError> {
    Err(not_ported_yet("signedMembers"))
}

// The authoring schema writes exactly one of `ignore` and `keep`, each with its reason.
fn keys_policy(_raw: &JsonObject) -> Result<Option<KeysPolicy>, PassError> {
    Err(not_ported_yet("keysPolicy"))
}

fn header_uses(
    entry: &mut IdentityEntry<'_, '_, '_>,
    principal: &Principal,
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
    _entry: &mut IdentityEntry<'_, '_, '_>,
    _principal: &Principal,
    _header: &str,
    _pointer: &str,
    _raw: &JsonObject,
) -> Result<Option<IdentityHeaderUse>, PassError> {
    Err(not_ported_yet("headerUse"))
}

// ADR 0002 section 9: a use sets `schema` only when the declaration has none; an actorSurface
// needs one.
fn use_schema(
    _entry: &mut IdentityEntry<'_, '_, '_>,
    _declared: &AccessIdentityHeader,
    _header: &str,
    _pointer: &str,
    _raw: &JsonObject,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("useSchema"))
}

// ADR 0002 section 9: a versionToken use names the principal field it carries (`from`) and the
// code answered to a stale request header (`stale`); no other use takes either.
fn version_token_members(
    _entry: &mut IdentityEntry<'_, '_, '_>,
    _principal: &Principal,
    _declared: &AccessIdentityHeader,
    _header: &str,
    _pointer: &str,
    _raw: &JsonObject,
) -> Result<Option<VersionTokenMembers>, PassError> {
    Err(not_ported_yet("versionTokenMembers"))
}
