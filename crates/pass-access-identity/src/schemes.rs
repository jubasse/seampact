//! The `schemes` catalogue (FR-27, ADR 0002 section 9, ADR 0013) in the tagged forms of ADR 0004
//! section 13, with the checks the authoring schema cannot state: the members each kind needs, a
//! cookie's `csrf` reference, and a signature scheme's keys against its `verify` form, its
//! templates and its tolerance.

use std::collections::{HashMap, HashSet};

use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    ApplicationSignature, BasicScheme, BearerFacts, BearerScheme, CookieScheme, HeaderScheme,
    IrMap, KnownScheme, KnownSchemeKey, KnownSignatureVerify, OAuth2, Origin, QueryScheme,
    SchemeId, SchemeKey, SignatureEncoding, SignatureScheme, SourceSchemeKey, TemplateSignature,
    ValueSchemeKey,
};
use seampact_json::{JsonObject, JsonValue, stringify_json};
use seampact_pipeline::{parse_duration, pointer_below};

use crate::read::{
    access_identity_entries, access_identity_member, access_identity_object,
    access_identity_string, access_identity_strings,
};
use crate::report::{AccessIdentityProblem, AccessIdentityReporter, AccessIdentityRule};
use crate::source::access_identity_value_source;

/// ADR 0013: `hmac-sha256` is the one v1 MAC. The IR enum is open and not must-act, so a weaker
/// value written here would reach every target unchecked.
pub(crate) const SIGNATURE_ALGORITHMS: &[&str] = &["hmac-sha256"];

/// `Number.MAX_SAFE_INTEGER`, the largest duration in milliseconds the IR holds exactly.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

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
    Key(KnownSchemeKey),
}

/// The encoding a signature is written in, `hex` or `base64`.
pub(crate) fn signature_encoding(text: &str) -> Option<SignatureEncoding> {
    match text {
        "hex" => Some(SignatureEncoding::Hex),
        "base64" => Some(SignatureEncoding::Base64),
        _ => None,
    }
}

// An HTTP token (RFC 9110, RFC 6265), as the authoring `headerName` is: ASCII letters, digits and
// ``!#$%&'*+-.^_`|~``.
fn is_http_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(character)
}

fn is_http_token(text: &str) -> bool {
    !text.is_empty() && text.chars().all(is_http_token_character)
}

// A query name keeps to the unreserved characters (RFC 3986), so no name needs escaping or can
// split its line.
fn is_query_name(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._~-".contains(character))
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
) -> Result<IrMap<SchemeId, KnownScheme>, InternalError> {
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
) -> Result<Option<KnownScheme>, InternalError> {
    let id = SchemeId::new(entry.id.to_owned());
    let origin = entry.origin.clone();

    match access_identity_string(entry.raw, "kind") {
        Some("cookie") => cookie_scheme(entry, kinds),
        Some(kind @ ("header" | "query")) => {
            let Some(name) = required_name(entry)? else {
                return Ok(None);
            };

            if kind == "header" {
                return Ok(Some(KnownScheme::Header(HeaderScheme { id, name, origin })));
            }

            Ok(Some(KnownScheme::Query(QueryScheme { id, name, origin })))
        }
        Some("bearer") => Ok(Some(bearer_scheme(entry)?)),
        Some("basic") => Ok(Some(KnownScheme::Basic(BasicScheme { id, origin }))),
        Some("signature") => signature_scheme(entry),
        // The authoring schema requires one of the six kinds.
        _ => Err(InternalError::new(format!(
            "the scheme at {} has no known kind",
            entry.pointer
        ))),
    }
}

// The cookie, header, query or signature header name, which the authoring schema leaves optional.
fn required_name(entry: &mut SchemeEntry<'_, '_, '_>) -> Result<Option<String>, InternalError> {
    let name = access_identity_string(entry.raw, "name");
    let kind = access_identity_string(entry.raw, "kind").unwrap_or("scheme");

    let Some(name) = name else {
        let subject = if kind == "signature" {
            "header carrying the signature".to_owned()
        } else {
            format!("{kind} name")
        };

        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SchemeMember,
            message: format!("{kind} scheme '{}' has no 'name'", entry.id),
            fix: format!("Set 'name' to the {subject}."),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    Ok(check_name(entry, kind, name)?.then(|| name.to_owned()))
}

// The name is quoted as JSON so a control character in it shows instead of breaking the
// diagnostic's line.
fn check_name(
    entry: &mut SchemeEntry<'_, '_, '_>,
    kind: &str,
    name: &str,
) -> Result<bool, InternalError> {
    let query = kind == "query";

    if (query && is_query_name(name)) || (!query && is_http_token(name)) {
        return Ok(true);
    }

    let (expected, fix) = if query {
        (
            "letters, digits and -._~",
            "Write the query parameter name with letters, digits and -._~ only.",
        )
    } else {
        (
            "an HTTP token",
            "Write the name as an HTTP token: letters, digits and !#$%&'*+-.^_`|~, without spaces, ';' or line breaks.",
        )
    };

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SchemeMember,
        message: format!(
            "{kind} scheme '{}' has name {}, which is not {expected}",
            entry.id,
            stringify_json(&JsonValue::String(name.to_owned()))
        ),
        fix: fix.to_owned(),
        pointer: pointer_below(&entry.pointer, &["name"]),
        related: Vec::new(),
    })?;

    Ok(false)
}

fn cookie_scheme(
    entry: &mut SchemeEntry<'_, '_, '_>,
    kinds: &HashMap<String, Option<String>>,
) -> Result<Option<KnownScheme>, InternalError> {
    let name = required_name(entry)?;
    let csrf = access_identity_string(entry.raw, "csrf");

    if let Some(csrf) = csrf
        && kinds.get(csrf).and_then(Option::as_deref) != Some("header")
    {
        let declared = kinds.contains_key(csrf);
        let (rule, message) = if declared {
            (
                AccessIdentityRule::SchemeKind,
                format!(
                    "cookie scheme '{}' names '{csrf}' as its csrf scheme, a {} scheme",
                    entry.id,
                    scheme_kind_text(kinds, csrf)
                ),
            )
        } else {
            (
                AccessIdentityRule::SchemeReference,
                format!(
                    "cookie scheme '{}' names '{csrf}' as its csrf scheme, which is no declared scheme",
                    entry.id
                ),
            )
        };

        entry.reporter.error(AccessIdentityProblem {
            rule,
            message,
            fix: "Name a header scheme, the header a cookie write must also present.".to_owned(),
            pointer: pointer_below(&entry.pointer, &["csrf"]),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let Some(name) = name else {
        return Ok(None);
    };

    Ok(Some(KnownScheme::Cookie(CookieScheme {
        id: SchemeId::new(entry.id.to_owned()),
        name,
        csrf: csrf.map(|written| SchemeId::new(written.to_owned())),
        origin: entry.origin.clone(),
    })))
}

/// The kind a scheme was written with, as the TypeScript prints it: `undefined` when it has none.
pub(crate) fn scheme_kind_text<'kinds>(
    kinds: &'kinds HashMap<String, Option<String>>,
    id: &str,
) -> &'kinds str {
    kinds
        .get(id)
        .and_then(Option::as_deref)
        .unwrap_or("undefined")
}

fn bearer_scheme(entry: &SchemeEntry<'_, '_, '_>) -> Result<KnownScheme, InternalError> {
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

    Ok(KnownScheme::Bearer(BearerScheme {
        id: SchemeId::new(entry.id.to_owned()),
        bearer: (!is_empty).then_some(bearer),
        origin: entry.origin.clone(),
    }))
}

fn signature_scheme(
    entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<Option<KnownScheme>, InternalError> {
    let name = required_name(entry)?;
    let verify = if access_identity_string(entry.raw, "verify") == Some("application") {
        application_signature(entry)?
    } else {
        template_signature(entry)?
    };

    let (Some(name), Some(verify)) = (name, verify) else {
        return Ok(None);
    };

    Ok(Some(KnownScheme::Signature(SignatureScheme {
        id: SchemeId::new(entry.id.to_owned()),
        name: Some(name),
        signature: verify.into(),
        origin: entry.origin.clone(),
    })))
}

// The authoring schema refuses the template members beside `verify: application`.
fn application_signature(
    entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<Option<KnownSignatureVerify>, InternalError> {
    let key = match signature_key(entry)? {
        SignatureKeyReading::Refused => return Ok(None),
        SignatureKeyReading::Absent => None,
        SignatureKeyReading::Key(key) => Some(SchemeKey::from(key)),
    };

    Ok(Some(KnownSignatureVerify::Application(
        ApplicationSignature {
            headers: access_identity_strings(entry.raw, "headers").unwrap_or_default(),
            key,
        },
    )))
}

fn quoted_members(members: &[&str]) -> String {
    let quoted: Vec<String> = members.iter().map(|member| format!("'{member}'")).collect();

    quoted.join(", ")
}

fn template_signature(
    entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<Option<KnownSignatureVerify>, InternalError> {
    let raw = entry.raw;
    let before = entry.reporter.errors();
    let missing: Vec<&str> = TEMPLATE_MEMBERS
        .iter()
        .copied()
        .filter(|member| access_identity_string(raw, member).is_none())
        .collect();

    if !missing.is_empty() {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureVerify,
            message: format!(
                "signature scheme '{}' verifies by template and has no {}",
                entry.id,
                quoted_members(&missing)
            ),
            fix: "Declare format, algorithm, payload and encoding (ADR 0013), or set 'verify: application' to verify in the authenticate hook.".to_owned(),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;
    }

    if access_identity_member(raw, "headers").is_some() {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureVerify,
            message: format!(
                "signature scheme '{}' verifies by template and lists 'headers'",
                entry.id
            ),
            fix: "Remove 'headers', which only 'verify: application' hands to the authenticate hook, or set 'verify: application'.".to_owned(),
            pointer: pointer_below(&entry.pointer, &["headers"]),
            related: Vec::new(),
        })?;
    }

    let format = access_identity_string(raw, "format").unwrap_or("");
    let payload = access_identity_string(raw, "payload").unwrap_or("");
    let algorithm = access_identity_string(raw, "algorithm").unwrap_or("");
    let encoding = access_identity_string(raw, "encoding").unwrap_or("");
    let mut tolerance_ms = None;

    if missing.is_empty() {
        check_format(entry, format)?;
        check_payload(entry, format, payload)?;
        check_algorithm(entry, algorithm)?;
        check_encoding(entry, encoding)?;
        tolerance_ms = tolerance(entry, format, payload)?;
    }

    let key = signature_key(entry)?;

    if key == SignatureKeyReading::Absent {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureKey,
            message: format!(
                "signature scheme '{}' verifies by template and has no 'key'",
                entry.id
            ),
            fix: "Name the key id the secret lookup receives: 'key: { value: <id> }' or 'key: { from: <path, query or header source> }'.".to_owned(),
            pointer: entry.pointer.clone(),
            related: Vec::new(),
        })?;
    }

    let SignatureKeyReading::Key(key) = key else {
        return Ok(None);
    };

    if entry.reporter.errors() > before {
        return Ok(None);
    }

    let Some(encoding) = signature_encoding(encoding) else {
        return Ok(None);
    };

    Ok(Some(KnownSignatureVerify::Template(TemplateSignature {
        format: format.to_owned(),
        algorithm: algorithm.to_owned(),
        payload: payload.to_owned(),
        encoding,
        tolerance_ms,
        key: key.into(),
    })))
}

// Comma-separated `name={placeholder}` pairs whose names are distinct tokens.
fn is_pair_format(format: &str) -> bool {
    let names: Vec<Option<&str>> = format.split(',').map(pair_name).collect();
    let written: Vec<&str> = names.iter().flatten().copied().collect();
    let distinct: HashSet<&str> = written.iter().copied().collect();

    written.len() == names.len() && distinct.len() == written.len()
}

// The token of one `name={sig}` or `name={ts}` pair.
fn pair_name(item: &str) -> Option<&str> {
    let name = item
        .strip_suffix("={sig}")
        .or_else(|| item.strip_suffix("={ts}"))?;

    is_http_token(name).then_some(name)
}

// A literal prefix without braces, then `{sig}`.
fn is_prefix_format(format: &str) -> bool {
    format
        .strip_suffix("{sig}")
        .is_some_and(|prefix| !prefix.contains(['{', '}']))
}

fn check_format(entry: &mut SchemeEntry<'_, '_, '_>, format: &str) -> Result<(), InternalError> {
    let placeholders = placeholders_of(format);
    let unknown = placeholders
        .iter()
        .any(|name| name != "sig" && name != "ts");
    let fits = count_of(&placeholders, "sig") == 1
        && count_of(&placeholders, "ts") <= 1
        && !unknown
        && (is_pair_format(format) || is_prefix_format(format));

    if fits {
        return Ok(());
    }

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SignatureTemplate,
        message: format!(
            "the format '{format}' of signature scheme '{}' is neither comma-separated 'name={{placeholder}}' pairs with distinct token names nor a literal prefix and '{{sig}}', with '{{sig}}' once and '{{ts}}' at most once",
            entry.id
        ),
        fix: "Write the header layout as 't={ts},v1={sig}' pairs or as a prefix and '{sig}', such as 'sha256={sig}' (ADR 0013).".to_owned(),
        pointer: pointer_below(&entry.pointer, &["format"]),
        related: Vec::new(),
    })
}

fn check_payload(
    entry: &mut SchemeEntry<'_, '_, '_>,
    format: &str,
    payload: &str,
) -> Result<(), InternalError> {
    let placeholders = placeholders_of(payload);
    let pointer = pointer_below(&entry.pointer, &["payload"]);
    let unknown = placeholders
        .iter()
        .any(|name| name != "rawBody" && name != "ts");

    if count_of(&placeholders, "rawBody") != 1 || count_of(&placeholders, "ts") > 1 || unknown {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureTemplate,
            message: format!(
                "the payload '{payload}' of signature scheme '{}' must hold '{{rawBody}}' once and '{{ts}}' at most once, and no other placeholder",
                entry.id
            ),
            fix: "Write the signed bytes from '{rawBody}', '{ts}' and literal text, such as '{ts}.{rawBody}'.".to_owned(),
            pointer: pointer.clone(),
            related: Vec::new(),
        })?;
    }

    let signs_timestamp = count_of(&placeholders, "ts") > 0;
    let reads_timestamp = count_of(&placeholders_of(format), "ts") > 0;

    if signs_timestamp && !reads_timestamp {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureTemplate,
            message: format!(
                "the payload of signature scheme '{}' signs '{{ts}}', which its format does not read",
                entry.id
            ),
            fix: "Add the '{ts}' pair to the format, or remove '{ts}' from the payload.".to_owned(),
            pointer: pointer.clone(),
            related: Vec::new(),
        })?;
    }

    // A timestamp the MAC does not cover is replayable with a fresh value, so the tolerance would
    // protect nothing.
    if reads_timestamp && !signs_timestamp {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureTemplate,
            message: format!(
                "the format of signature scheme '{}' reads '{{ts}}', which its payload does not sign",
                entry.id
            ),
            fix: "Add '{ts}' to the payload, such as '{ts}.{rawBody}', or remove the '{ts}' pair from the format.".to_owned(),
            pointer,
            related: Vec::new(),
        })?;
    }

    Ok(())
}

fn check_algorithm(
    entry: &mut SchemeEntry<'_, '_, '_>,
    algorithm: &str,
) -> Result<(), InternalError> {
    if SIGNATURE_ALGORITHMS.contains(&algorithm) {
        return Ok(());
    }

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SignatureTemplate,
        message: format!(
            "signature scheme '{}' has algorithm '{algorithm}', which is not {}",
            entry.id,
            SIGNATURE_ALGORITHMS.join(" or ")
        ),
        fix: "Set 'algorithm' to 'hmac-sha256', or set 'verify: application' to verify any other MAC in the authenticate hook.".to_owned(),
        pointer: pointer_below(&entry.pointer, &["algorithm"]),
        related: Vec::new(),
    })
}

fn check_encoding(
    entry: &mut SchemeEntry<'_, '_, '_>,
    encoding: &str,
) -> Result<(), InternalError> {
    if signature_encoding(encoding).is_some() {
        return Ok(());
    }

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SignatureTemplate,
        message: format!(
            "signature scheme '{}' has encoding '{encoding}', which is neither hex nor base64",
            entry.id
        ),
        fix: "Set 'encoding' to 'hex' or 'base64'.".to_owned(),
        pointer: pointer_below(&entry.pointer, &["encoding"]),
        related: Vec::new(),
    })
}

// ADR 0002 section 9: `tolerance` is required when `{ts}` is used and refused otherwise.
fn tolerance(
    entry: &mut SchemeEntry<'_, '_, '_>,
    format: &str,
    payload: &str,
) -> Result<Option<i64>, InternalError> {
    let written = access_identity_string(entry.raw, "tolerance");
    let uses_timestamp = count_of(&placeholders_of(format), "ts") > 0
        || count_of(&placeholders_of(payload), "ts") > 0;

    let Some(written) = written else {
        if uses_timestamp {
            entry.reporter.error(AccessIdentityProblem {
                rule: AccessIdentityRule::SignatureTolerance,
                message: format!(
                    "signature scheme '{}' reads '{{ts}}' and has no 'tolerance'",
                    entry.id
                ),
                fix: "Set 'tolerance' to the largest distance accepted between the signed timestamp and now, such as '5m'.".to_owned(),
                pointer: entry.pointer.clone(),
                related: Vec::new(),
            })?;
        }

        return Ok(None);
    };

    let pointer = pointer_below(&entry.pointer, &["tolerance"]);

    if !uses_timestamp {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureTolerance,
            message: format!(
                "signature scheme '{}' has a 'tolerance' and reads no '{{ts}}'",
                entry.id
            ),
            fix: "Remove 'tolerance', or add '{ts}' to the format and the payload.".to_owned(),
            pointer,
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let tolerance_ms = parse_duration(written)?;

    let Some(tolerance_ms) = tolerance_ms else {
        entry.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SignatureTolerance,
            message: format!(
                "the tolerance '{written}' of signature scheme '{}' is beyond {MAX_SAFE_INTEGER} milliseconds",
                entry.id
            ),
            fix: "Write a tolerance of minutes, such as '5m'.".to_owned(),
            pointer,
            related: Vec::new(),
        })?;

        return Ok(None);
    };

    let milliseconds = i64::try_from(tolerance_ms).map_err(|_| {
        InternalError::new(format!(
            "the tolerance '{written}' parsed to {tolerance_ms} milliseconds, beyond the IR's integers"
        ))
    })?;

    Ok(Some(milliseconds))
}

// The scheme's key: absent, refused (an empty mapping), or its tagged form.
fn signature_key(
    entry: &mut SchemeEntry<'_, '_, '_>,
) -> Result<SignatureKeyReading, InternalError> {
    let Some(key) = access_identity_object(entry.raw, "key") else {
        return Ok(SignatureKeyReading::Absent);
    };

    if let Some(value) = access_identity_string(key, "value") {
        return Ok(SignatureKeyReading::Key(KnownSchemeKey::Value(
            ValueSchemeKey {
                value: value.to_owned(),
            },
        )));
    }

    if let Some(from) = access_identity_string(key, "from") {
        return Ok(SignatureKeyReading::Key(KnownSchemeKey::Source(
            SourceSchemeKey {
                from: access_identity_value_source(from)?,
            },
        )));
    }

    entry.reporter.error(AccessIdentityProblem {
        rule: AccessIdentityRule::SignatureKey,
        message: format!(
            "the key of signature scheme '{}' names neither a value nor a source",
            entry.id
        ),
        fix: "Write 'key: { value: <id> }' or 'key: { from: <path, query or header source> }'."
            .to_owned(),
        pointer: pointer_below(&entry.pointer, &["key"]),
        related: Vec::new(),
    })?;

    Ok(SignatureKeyReading::Refused)
}
