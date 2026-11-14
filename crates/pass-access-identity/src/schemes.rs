//! The `schemes` catalogue (FR-27, ADR 0002 section 9, ADR 0013) in the tagged forms of ADR 0004
//! section 13, with the checks the authoring schema cannot state: the members each kind needs, a
//! cookie's `csrf` reference, and a signature scheme's keys against its `verify` form, its
//! templates and its tolerance.

use std::collections::HashMap;

use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    BasicScheme, BearerFacts, BearerScheme, HeaderScheme, IrMap, OAuth2, Origin, QueryScheme,
    Scheme, SchemeId, SchemeKey, SignatureVerify,
};
use seampact_json::JsonObject;
use seampact_pipeline::{PassError, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::{
    access_identity_entries, access_identity_member, access_identity_object, access_identity_string,
};
use crate::report::AccessIdentityReporter;

/// The encodings a signature may be written in.
pub(crate) const SIGNATURE_ENCODINGS: &[&str] = &["hex", "base64"];

/// ADR 0013: `hmac-sha256` is the one v1 MAC. The IR enum is open and not must-act, so a weaker
/// value written here would reach every target unchecked.
pub(crate) const SIGNATURE_ALGORITHMS: &[&str] = &["hmac-sha256"];

/// ADR 0013: a format is comma-separated `name={placeholder}` pairs, each name a distinct token,
/// or a literal prefix and `{sig}`. ECMAScript patterns, compiled by the brief that ports their
/// users.
pub(crate) const FORMAT_PAIR_PATTERN: &str = r"^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=\{(sig|ts)\}$";

pub(crate) const FORMAT_PREFIX_PATTERN: &str = r"^[^{}]*\{sig\}$";

/// A cookie or header name is an HTTP token (RFC 9110, RFC 6265), as the authoring `headerName`
/// is.
pub(crate) const HTTP_TOKEN_PATTERN: &str = r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$";

/// A query name keeps to the unreserved characters (RFC 3986), so no name needs escaping or can
/// split its line.
pub(crate) const QUERY_NAME_PATTERN: &str = r"^[A-Za-z0-9._~-]+$";

/// The members of a template signature.
pub(crate) const TEMPLATE_MEMBERS: &[&str] = &["format", "algorithm", "payload", "encoding"];

/// One written scheme and what its checks read.
pub(crate) struct SchemeEntry<'entry, 'half, 'run> {
    pub(crate) id: &'entry str,
    pub(crate) pointer: String,
    pub(crate) raw: &'entry JsonObject,
    pub(crate) origin: Origin,
    pub(crate) reporter: &'entry mut AccessIdentityReporter<'half, 'run>,
}

/// What a signature scheme's `key` reads as: absent, refused (an empty mapping), or its tagged
/// form.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SignatureKeyReading {
    Absent,
    Refused,
    Key(SchemeKey),
}

pub(crate) fn is_signature_encoding(text: &str) -> bool {
    SIGNATURE_ENCODINGS.contains(&text)
}

/// The names of the `{name}` placeholders of a template, in order (ECMAScript `\{([A-Za-z]+)\}`
/// read left to right, matches not overlapping).
pub(crate) fn placeholders_of(template: &str) -> Vec<String> {
    let characters: Vec<char> = template.chars().collect();
    let mut names = Vec::new();
    let mut at = 0;

    while let Some(&character) = characters.get(at) {
        let letters = if character == '{' {
            characters
                .iter()
                .skip(at + 1)
                .take_while(|next| next.is_ascii_alphabetic())
                .count()
        } else {
            0
        };

        if letters > 0 && characters.get(at + 1 + letters) == Some(&'}') {
            names.push(characters.iter().skip(at + 1).take(letters).collect());
            at += letters + 2;
        } else {
            at += 1;
        }
    }

    names
}

pub(crate) fn count_of(items: &[String], item: &str) -> usize {
    items
        .iter()
        .filter(|candidate| candidate.as_str() == item)
        .count()
}

/// Each written scheme's `kind`, also for a scheme left out of the catalogue for an error.
pub(crate) fn access_identity_scheme_kinds(raw: &RawApi) -> HashMap<String, Option<String>> {
    access_identity_entries(&raw.merged, "schemes")
        .into_iter()
        .map(|(id, written)| {
            (
                id.to_owned(),
                access_identity_string(written, "kind").map(str::to_owned),
            )
        })
        .collect()
}

/// The schemes of the api, by id, in written order; a scheme with an error is left out.
pub(crate) fn access_identity_schemes(
    kinds: &HashMap<String, Option<String>>,
    reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<IrMap<SchemeId, Scheme>, PassError> {
    let raw = reporter.raw();
    let mut schemes = IrMap::new();

    for (id, written) in access_identity_entries(&raw.merged, "schemes") {
        let pointer = pointer_below("", &["schemes", id]);
        let origin = reporter
            .origin(&pointer)
            .ok_or_else(|| InternalError::new(format!("the scheme at {pointer} has no origin")))?;
        let before = reporter.errors();
        let mut entry = SchemeEntry {
            id,
            pointer,
            raw: written,
            origin,
            reporter: &mut *reporter,
        };
        let scheme = scheme_of(&mut entry, kinds)?;

        if let Some(scheme) = scheme
            && reporter.errors() == before
        {
            schemes.insert(SchemeId::new(id.to_owned()), scheme);
        }
    }

    Ok(schemes)
}

fn scheme_of(
    entry: &mut SchemeEntry<'_, '_, '_>,
    kinds: &HashMap<String, Option<String>>,
) -> Result<Option<Scheme>, PassError> {
    let id = SchemeId::new(entry.id.to_owned());
    let origin = entry.origin.clone();

    match access_identity_string(entry.raw, "kind") {
        Some("cookie") => cookie_scheme(entry, kinds),
        Some(kind @ ("header" | "query")) => {
            let Some(name) = required_name(entry)? else {
                return Ok(None);
            };

            if kind == "header" {
                return Ok(Some(Scheme::Header(HeaderScheme { id, name, origin })));
            }

            Ok(Some(Scheme::Query(QueryScheme { id, name, origin })))
        }
        Some("bearer") => Ok(Some(bearer_scheme(entry)?)),
        Some("basic") => Ok(Some(Scheme::Basic(BasicScheme { id, origin }))),
        Some("signature") => signature_scheme(entry),
        // The authoring schema requires one of the six kinds.
        _ => Err(
            InternalError::new(format!("the scheme at {} has no known kind", entry.pointer)).into(),
        ),
    }
}

// The cookie, header, query or signature header name, which the authoring schema leaves optional.
fn required_name(_entry: &mut SchemeEntry<'_, '_, '_>) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("requiredName"))
}

fn check_name(
    _entry: &mut SchemeEntry<'_, '_, '_>,
    _kind: &str,
    _name: &str,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkName"))
}

fn cookie_scheme(
    _entry: &mut SchemeEntry<'_, '_, '_>,
    _kinds: &HashMap<String, Option<String>>,
) -> Result<Option<Scheme>, PassError> {
    Err(not_ported_yet("cookieScheme"))
}

fn bearer_scheme(entry: &SchemeEntry<'_, '_, '_>) -> Result<Scheme, InternalError> {
    let format = access_identity_string(entry.raw, "bearerFormat").map(str::to_owned);
    let oauth2 = access_identity_object(entry.raw, "oauth2");
    let open_id_connect_url = access_identity_string(entry.raw, "openIdConnect").map(str::to_owned);

    // The authoring schema refuses `oauth2` beside `openIdConnect`.
    let oauth2 = oauth2
        .map(|written| {
            access_identity_member(written, "flows")
                .map(|flows| OAuth2 {
                    flows: flows.clone(),
                })
                .ok_or_else(|| {
                    InternalError::new(format!(
                        "the oauth2 scheme at {} has no flows",
                        entry.pointer
                    ))
                })
        })
        .transpose()?;
    let bearer = BearerFacts {
        format,
        oauth2,
        open_id_connect_url,
    };
    let is_empty =
        bearer.format.is_none() && bearer.oauth2.is_none() && bearer.open_id_connect_url.is_none();

    Ok(Scheme::Bearer(BearerScheme {
        id: SchemeId::new(entry.id.to_owned()),
        bearer: (!is_empty).then_some(bearer),
        origin: entry.origin.clone(),
    }))
}

fn signature_scheme(_entry: &mut SchemeEntry<'_, '_, '_>) -> Result<Option<Scheme>, PassError> {
    Err(not_ported_yet("signatureScheme"))
}

// The authoring schema refuses the template members beside `verify: application`.
fn application_signature(
    _entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<Option<SignatureVerify>, PassError> {
    Err(not_ported_yet("applicationSignature"))
}

fn template_signature(
    _entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<Option<SignatureVerify>, PassError> {
    Err(not_ported_yet("templateSignature"))
}

// Comma-separated `name={placeholder}` pairs whose names are distinct tokens.
fn is_pair_format(_format: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isPairFormat"))
}

fn check_format(_entry: &mut SchemeEntry<'_, '_, '_>, _format: &str) -> Result<(), PassError> {
    Err(not_ported_yet("checkFormat"))
}

fn check_payload(
    _entry: &mut SchemeEntry<'_, '_, '_>,
    _format: &str,
    _payload: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkPayload"))
}

fn check_algorithm(
    _entry: &mut SchemeEntry<'_, '_, '_>,
    _algorithm: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkAlgorithm"))
}

fn check_encoding(_entry: &mut SchemeEntry<'_, '_, '_>, _encoding: &str) -> Result<(), PassError> {
    Err(not_ported_yet("checkEncoding"))
}

// ADR 0002 section 9: `tolerance` is required when `{ts}` is used and refused otherwise.
fn tolerance(
    _entry: &mut SchemeEntry<'_, '_, '_>,
    _format: &str,
    _payload: &str,
) -> Result<Option<i64>, PassError> {
    Err(not_ported_yet("tolerance"))
}

// The scheme's key: absent, refused (an empty mapping), or its tagged form.
fn signature_key(_entry: &mut SchemeEntry<'_, '_, '_>) -> Result<SignatureKeyReading, PassError> {
    Err(not_ported_yet("signatureKey"))
}
