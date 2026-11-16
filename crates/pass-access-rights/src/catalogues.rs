//! The `rights`, `rules`, `scopes` and `buckets` catalogues (ADR 0002 section 9, ADR 0004
//! section 4). An entry with an error is left out, so a requirement naming it reports nothing more.

use std::collections::{HashMap, HashSet};

use regress::Regex;
use seampact_diagnostics::InternalError;
use seampact_diagnostics::access_rights_quoted;
use seampact_ir::IrMap;
use seampact_ir::{
    Bucket, BucketId, Direction, ErrorCode, KnownRightSubject, KnownTypeUseRef, Name, NameRole,
    NoSubject, ProofPlacement, Reason, ResourceSubject, Right, RightId, RightSubject, Rule, RuleId,
    RuleProof, Scope, ScopeId, ScopeSubject, TypeUse,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue, js_integer_in_range, stringify_json};
use seampact_naming::{NameSource, SegmentsOptions, SegmentsResult, segments_of, split_name};
use seampact_pipeline::{ConventionReading, PassError, parse_duration, pointer_below};

use crate::read::{
    access_rights_docs, access_rights_entries, access_rights_extensions, access_rights_member,
    access_rights_object, access_rights_origin_of, access_rights_schema_name, access_rights_string,
    access_rights_strings,
};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::schema_use::{AccessRightsContext, access_rights_params_ref, access_rights_type_use};
use crate::source::{access_rights_source_text, access_rights_value_source};

/// The names declared in each catalogue, refused ones included, so a use of a refused one adds no
/// error. A pack-derived right that is refused adds its name too.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AccessRightsDeclared {
    pub(crate) rights: HashSet<String>,
    pub(crate) rules: HashSet<String>,
    pub(crate) scopes: HashSet<String>,
    pub(crate) buckets: HashSet<String>,
}

/// `conventions.rights.pattern`, compiled, with its pointer.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRightPattern {
    pub(crate) pattern: Regex,
    /// The pattern as `RegExp.source` writes it, for the message.
    pub(crate) source: String,
    pub(crate) pointer: String,
}

/// The catalogues the half builds, by id, before it writes them.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsCatalogues {
    pub(crate) rights: seampact_ir::IrMap<RightId, Right>,
    pub(crate) rules: seampact_ir::IrMap<RuleId, Rule>,
    pub(crate) scopes: seampact_ir::IrMap<ScopeId, Scope>,
    pub(crate) buckets: seampact_ir::IrMap<BucketId, Bucket>,
    /// The schema each resource right's id names (`TaskId`), when it names one; pack-derived
    /// rights add theirs.
    pub(crate) right_id_names: HashMap<String, String>,
    pub(crate) declared: AccessRightsDeclared,
    /// The code of the `forbidden` role, which a right without written `errors` answers.
    pub(crate) forbidden_code: String,
    /// `None` when the convention is not written.
    pub(crate) right_pattern: Option<AccessRightsRightPattern>,
}

/// What `accessRightsCheckName` reads of one right id.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsNameCheck<'pattern> {
    pub(crate) id: String,
    pub(crate) code_name: Option<String>,
    pub(crate) pointer: String,
    pub(crate) right_pattern: Option<&'pattern AccessRightsRightPattern>,
}

/// One right declaration with what its builder needs besides the context.
#[derive(Debug, Clone)]
pub(crate) struct RightDeclaration<'raw, 'pattern> {
    pub(crate) id: String,
    pub(crate) declaration: &'raw JsonObject,
    pub(crate) scope_names: &'pattern HashSet<String>,
    pub(crate) right_pattern: Option<&'pattern AccessRightsRightPattern>,
    pub(crate) forbidden_code: &'pattern str,
}

/// One scope or right declaration read with the scope names the api declares.
#[derive(Debug, Clone)]
pub(crate) struct DeclarationWithScopes<'raw, 'names> {
    pub(crate) id: String,
    pub(crate) declaration: &'raw JsonObject,
    pub(crate) scope_names: &'names HashSet<String>,
}

/// The largest prefix an address bucket key may count (an IPv6 address).
const ADDRESS_BITS: i64 = 128;

const RIGHT_PATTERN_POINTER: &str = "/conventions/rights/pattern";

const PROOF_PLACEMENTS: &[&str] = &["header", "body"];

/// Builds the four catalogues, reporting each declaration's errors.
///
/// # Errors
///
/// An internal error.
pub(crate) fn access_rights_catalogues(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
) -> Result<AccessRightsCatalogues, PassError> {
    let merged = Some(&context.context.raw.merged);
    let scope_names = names_of(merged, "scopes");
    let right_pattern = right_pattern_of(context, reporter)?;
    let forbidden_code = forbidden_code_of(context)?;

    let mut rights = IrMap::new();
    let mut right_id_names = HashMap::new();

    for (id, declaration) in access_rights_entries(merged, "rights") {
        let declared = RightDeclaration {
            id: id.to_owned(),
            declaration,
            scope_names: &scope_names,
            right_pattern: right_pattern.as_ref(),
            forbidden_code: &forbidden_code,
        };
        let Some(right) = right_of(context, reporter, &declared)? else {
            continue;
        };

        rights.insert(RightId::new(id.to_owned()), right);

        let subject = access_rights_object(access_rights_member(Some(declaration), "subject"));

        if let Some(id_name) = access_rights_schema_name(access_rights_member(subject, "id")) {
            right_id_names.insert(id.to_owned(), id_name);
        }
    }

    let mut rules = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "rules") {
        if let Some(rule) = rule_of(context, reporter, id, declaration)? {
            rules.insert(RuleId::new(id.to_owned()), rule);
        }
    }

    let mut scopes = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "scopes") {
        let declared = DeclarationWithScopes {
            id: id.to_owned(),
            declaration,
            scope_names: &scope_names,
        };

        if let Some(scope) = scope_of(context, reporter, &declared)? {
            scopes.insert(ScopeId::new(id.to_owned()), scope);
        }
    }

    let mut buckets = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "buckets") {
        if let Some(bucket) = bucket_of(context, reporter, id, declaration)? {
            buckets.insert(BucketId::new(id.to_owned()), bucket);
        }
    }

    Ok(AccessRightsCatalogues {
        rights,
        rules,
        scopes,
        buckets,
        right_id_names,
        forbidden_code,
        declared: AccessRightsDeclared {
            rights: names_of(merged, "rights"),
            rules: names_of(merged, "rules"),
            scopes: scope_names,
            buckets: names_of(merged, "buckets"),
        },
        right_pattern,
    })
}

// The keys of a catalogue member, refused entries included.
fn names_of(merged: Option<&JsonObject>, catalogue: &str) -> HashSet<String> {
    access_rights_object(access_rights_member(merged, catalogue))
        .map(|entries| entries.keys().cloned().collect())
        .unwrap_or_default()
}

// The role binding is a code, or `{ code, params }` (ADR 0002 section 11); the core binds every
// role by default.
pub(crate) fn forbidden_code_of(context: &AccessRightsContext) -> Result<String, InternalError> {
    let binding = context
        .context
        .conventions
        .get("errors.derived.forbidden")?
        .map(|reading| reading.value);
    let code = match binding {
        Some(JsonValue::String(code)) => Some(code.as_str()),
        other => access_rights_string(access_rights_object(other), "code"),
    };

    code.map(str::to_owned).ok_or_else(|| {
        let written = binding.map_or_else(|| "undefined".to_owned(), stringify_json);

        InternalError::new(format!(
            "conventions.errors.derived.forbidden binds no code: {written}"
        ))
    })
}

/// `RegExp.prototype.source` of a pattern: an empty one reads `(?:)`, a `/` outside a class and
/// the line terminators are escaped.
fn regexp_source_of(written: &str) -> String {
    if written.is_empty() {
        return "(?:)".to_owned();
    }

    let mut source = String::with_capacity(written.len());
    let mut in_class = false;
    let mut escaped = false;

    for character in written.chars() {
        match character {
            '\n' => source.push_str("\\n"),
            '\r' => source.push_str("\\r"),
            '\u{2028}' => source.push_str("\\u2028"),
            '\u{2029}' => source.push_str("\\u2029"),
            '/' if !in_class && !escaped => source.push_str("\\/"),
            other => source.push(other),
        }

        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if in_class {
            in_class = character != ']';
        } else {
            in_class = character == '[';
        }
    }

    source
}

pub(crate) fn right_pattern_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
) -> Result<Option<AccessRightsRightPattern>, InternalError> {
    let Some(ConventionReading {
        value: JsonValue::String(written),
        ..
    }) = context.context.conventions.get("rights.pattern")?
    else {
        return Ok(None);
    };

    match Regex::with_flags(written, "u") {
        Ok(pattern) => Ok(Some(AccessRightsRightPattern {
            pattern,
            source: regexp_source_of(written),
            pointer: RIGHT_PATTERN_POINTER.to_owned(),
        })),
        Err(error) => {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::RightPattern,
                message: format!(
                    "conventions.rights.pattern '{written}' is no regular expression: SyntaxError: Invalid regular expression: /{written}/u: {error}"
                ),
                fix: "write a regular expression every right name must match".to_owned(),
                pointer: RIGHT_PATTERN_POINTER.to_owned(),
                distinct_by: None,
                related: Vec::new(),
            });

            Ok(None)
        }
    }
}

/// A right's `errors` as written, else the code of the `forbidden` role.
pub(crate) fn access_rights_right_errors(
    declaration: Option<&JsonObject>,
    forbidden_code: &str,
) -> Vec<String> {
    if access_rights_member(declaration, "errors").is_none() {
        return vec![forbidden_code.to_owned()];
    }

    access_rights_strings(declaration, "errors")
}

fn error_codes_of(codes: Vec<String>) -> Vec<ErrorCode> {
    codes.into_iter().map(ErrorCode::new).collect()
}

pub(crate) fn schema_name_of(written: &str) -> Name {
    Name {
        segments: split_name(written),
        role: NameRole::Schema,
        status: None,
    }
}

/// The authoring schema allows a proof in a header or the body only.
///
/// # Errors
///
/// An internal error for any other placement.
pub(crate) fn proof_placement(
    placement: &str,
    pointer: &str,
) -> Result<ProofPlacement, InternalError> {
    match PROOF_PLACEMENTS.iter().find(|known| **known == placement) {
        Some(&"header") => Ok(ProofPlacement::Header),
        Some(_) => Ok(ProofPlacement::Body),
        None => Err(InternalError::new(format!(
            "the proof of the rule at {pointer} is in '{placement}', neither header nor body"
        ))),
    }
}

pub(crate) fn scope_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    options: &DeclarationWithScopes<'_, '_>,
) -> Result<Option<Scope>, PassError> {
    let DeclarationWithScopes {
        id,
        declaration,
        scope_names,
    } = options;
    let pointer = pointer_below("/scopes", &[id]);
    let within = access_rights_string(Some(declaration), "within");

    if within.is_some() && !within_chain_terminates(context, reporter, id, scope_names)? {
        return Ok(None);
    }

    Ok(Some(Scope {
        id: ScopeId::new(id.clone()),
        id_schema: access_rights_type_use(
            context,
            &pointer_below(&pointer, &["id"]),
            &Direction::Input,
        )?,
        within: within.map(|name| ScopeId::new(name.to_owned())),
        errors: error_codes_of(access_rights_strings(Some(declaration), "errors")),
        docs: access_rights_docs(declaration).into(),
        extensions: access_rights_extensions(declaration),
        origin: access_rights_origin_of(context, &pointer)?,
    }))
}

pub(crate) fn right_subject_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    options: &DeclarationWithScopes<'_, '_>,
) -> Result<Option<RightSubject>, PassError> {
    let DeclarationWithScopes {
        id,
        declaration,
        scope_names,
    } = options;
    let pointer = pointer_below("/rights", &[id]);
    let subject = access_rights_object(access_rights_member(Some(declaration), "subject"));
    let scope = access_rights_string(subject, "scope");
    let resource = access_rights_string(subject, "resource");

    if let Some(scope) = scope {
        if scope_names.contains(scope) {
            return Ok(Some(
                KnownRightSubject::Scope(ScopeSubject {
                    scope: ScopeId::new(scope.to_owned()),
                })
                .into(),
            ));
        }

        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RightSubject,
            message: format!(
                "the subject of right '{id}' names scope '{scope}', which the scopes catalogue does not declare"
            ),
            fix: "declare the scope in 'scopes', or name a declared one".to_owned(),
            pointer: pointer_below(&pointer, &["subject", "scope"]),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    }

    let Some(resource) = resource else {
        return Ok(Some(KnownRightSubject::NoSubject(NoSubject {}).into()));
    };
    let id_schema = access_rights_type_use(
        context,
        &pointer_below(&pointer, &["subject", "id"]),
        &Direction::Input,
    )?;

    Ok(Some(
        KnownRightSubject::Resource(ResourceSubject {
            r#type: schema_name_of(resource),
            id_schema,
        })
        .into(),
    ))
}

pub(crate) fn right_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    declared: &RightDeclaration<'_, '_>,
) -> Result<Option<Right>, PassError> {
    let RightDeclaration {
        id,
        declaration,
        scope_names,
        right_pattern,
        forbidden_code,
    } = declared;
    let pointer = pointer_below("/rights", &[id]);
    let code_name = access_rights_string(Some(declaration), "codeName");
    let name_check = AccessRightsNameCheck {
        id: id.clone(),
        code_name: code_name.map(str::to_owned),
        pointer: pointer.clone(),
        right_pattern: *right_pattern,
    };

    if !access_rights_check_name(reporter, &name_check)? {
        return Ok(None);
    }

    let subject_declaration = DeclarationWithScopes {
        id: id.clone(),
        declaration,
        scope_names,
    };
    let Some(subject) = right_subject_of(context, reporter, &subject_declaration)? else {
        return Ok(None);
    };
    let params = if access_rights_member(Some(declaration), "params").is_some() {
        Some(access_rights_params_ref(
            context,
            &pointer_below(&pointer, &["params"]),
        )?)
    } else {
        None
    };

    Ok(Some(Right {
        id: RightId::new(id.clone()),
        params,
        subject,
        guest: access_rights_string(Some(declaration), "guest")
            .map(|reason| Reason::new(reason.to_owned())),
        errors: error_codes_of(access_rights_right_errors(
            Some(declaration),
            forbidden_code,
        )),
        docs: access_rights_docs(declaration).into(),
        extensions: access_rights_extensions(declaration),
        origin: access_rights_origin_of(context, &pointer)?,
        derived_from: None,
        code_name: code_name.map(schema_name_of),
    }))
}

/// Checks a right name, declared or derived, against the naming rules (ADR 0002 section 4,
/// ADR 0007 section 2): `conventions.rights.pattern` when written, and an identifier segment or a
/// `codeName`. True when it passes.
///
/// # Errors
///
/// An internal error when the naming rules refuse the call.
pub(crate) fn access_rights_check_name(
    reporter: &mut AccessRightsReporter,
    options: &AccessRightsNameCheck<'_>,
) -> Result<bool, InternalError> {
    let AccessRightsNameCheck {
        id,
        code_name,
        pointer,
        right_pattern,
    } = options;
    let mut passes = true;

    if let Some(right_pattern) = right_pattern
        && right_pattern.pattern.find(id).is_none()
    {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RightPattern,
            message: format!(
                "right '{id}' does not match conventions.rights.pattern '{}'",
                right_pattern.source
            ),
            fix: "rename the right to match the pattern, or change the pattern".to_owned(),
            pointer: pointer.clone(),
            distinct_by: None,
            related: vec![AccessRightsRelated {
                pointer: right_pattern.pointer.clone(),
                message: "the pattern is set here".to_owned(),
            }],
        });
        passes = false;
    }

    let segments = segments_of(
        id,
        NameSource::Right,
        &SegmentsOptions {
            code_name: code_name.clone(),
            position: None,
        },
    )
    .map_err(|error| InternalError::new(error.to_string()))?;

    if segments == SegmentsResult::NoSegment {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::RightName,
            message: match code_name {
                None => format!("right '{id}' yields no identifier segment for generated code"),
                Some(code_name) => {
                    format!(
                        "the codeName '{code_name}' of right '{id}' yields no identifier segment"
                    )
                }
            },
            fix: "set the right's codeName to a name with letters or digits".to_owned(),
            pointer: pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });
        passes = false;
    }

    Ok(passes)
}

pub(crate) fn bucket_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    id: &str,
    declaration: &JsonObject,
) -> Result<Option<Bucket>, PassError> {
    let pointer = pointer_below("/buckets", &[id]);
    let mut key = Vec::new();

    for (index, text) in access_rights_strings(Some(declaration), "key")
        .iter()
        .enumerate()
    {
        let Some(source) = access_rights_value_source(text)? else {
            return Err(InternalError::new(format!(
                "the bucket key '{text}' at {pointer} is outside the grammar's forms"
            ))
            .into());
        };

        if source.prefix_bits.is_some_and(|bits| bits > ADDRESS_BITS) {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::BucketKey,
                message: format!(
                    "bucket '{id}' counts {}, a prefix longer than {ADDRESS_BITS} bits",
                    access_rights_source_text(&source)
                ),
                fix: format!("count a prefix of at most {ADDRESS_BITS} bits"),
                pointer: pointer_below(&pointer, &["key", &index.to_string()]),
                distinct_by: None,
                related: Vec::new(),
            });

            return Ok(None);
        }

        key.push(source);
    }

    let limit = bucket_limit_of(declaration, &pointer)?;
    let window = access_rights_string(Some(declaration), "window");
    let window_ms = window.map(parse_duration).transpose()?.flatten();

    if let (Some(window), None) = (window, window_ms) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::BucketWindow,
            message: format!(
                "the window '{}' of bucket '{id}' is too long to count in milliseconds",
                access_rights_quoted(window)
            ),
            fix: "write a shorter window".to_owned(),
            pointer: pointer_below(&pointer, &["window"]),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    }

    let window_ms = window_ms
        .map(|milliseconds| {
            i64::try_from(milliseconds).map_err(|error| {
                InternalError::new(format!(
                    "the window of the bucket at {pointer} does not fit an integer: {error}"
                ))
            })
        })
        .transpose()?;

    Ok(Some(Bucket {
        id: BucketId::new(id.to_owned()),
        key,
        limit,
        window_ms,
        origin: access_rights_origin_of(context, &pointer)?,
    }))
}

fn bucket_limit_of(declaration: &JsonObject, pointer: &str) -> Result<Option<i64>, InternalError> {
    match access_rights_member(Some(declaration), "limit") {
        None => Ok(None),
        Some(JsonValue::Number(limit)) => js_integer_in_range(limit, i64::MIN..=i64::MAX)
            .map(Some)
            .map_err(|error| {
                InternalError::new(format!(
                    "the limit of the bucket at {pointer} is no integer: {error}"
                ))
            }),
        Some(_) => Err(InternalError::new(format!(
            "the limit of the bucket at {pointer} is no number"
        ))),
    }
}

pub(crate) fn rule_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    id: &str,
    declaration: &JsonObject,
) -> Result<Option<Rule>, PassError> {
    let pointer = pointer_below("/rules", &[id]);
    let proof = access_rights_object(access_rights_member(Some(declaration), "proof"));
    let proof_written = access_rights_member(Some(declaration), "proof").is_some();
    let placement = access_rights_string(proof, "in");
    let proof_name = access_rights_string(proof, "name");

    // A proof without a schema has no type: a target could neither read nor check it.
    if proof_written && access_rights_member(proof, "schema").is_none() {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ProofSchema,
            message: format!("the proof of rule '{id}' declares no schema"),
            fix: "set the proof's 'schema' to the named schema of the value it reads".to_owned(),
            pointer: pointer_below(&pointer, &["proof"]),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    }

    let proof_schema = match (placement, proof_name) {
        (Some(_), Some(_)) => Some(access_rights_type_use(
            context,
            &pointer_below(&pointer, &["proof", "schema"]),
            &Direction::Input,
        )?),
        _ => None,
    };

    // A proof is a value a target reads and compares, sent as a field or a header: never a file or
    // opaque.
    if let Some(proof_schema) = &proof_schema
        && let Some(kind) = unreadable_proof_kind(proof_schema)?
    {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::ProofSchema,
            message: format!(
                "the proof of rule '{id}' is {}, which a rule cannot read as a proof",
                match kind {
                    UnreadableProofKind::File => "a file",
                    UnreadableProofKind::Opaque => "an opaque value",
                }
            ),
            fix: "set the proof's 'schema' to a scalar, an enum or a named schema".to_owned(),
            pointer: pointer_below(&pointer, &["proof", "schema"]),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    }

    let params = if access_rights_member(Some(declaration), "params").is_some() {
        Some(access_rights_params_ref(
            context,
            &pointer_below(&pointer, &["params"]),
        )?)
    } else {
        None
    };
    let proof = match (placement, proof_name, proof_schema) {
        (Some(placement), Some(name), Some(schema)) => Some(RuleProof {
            r#in: proof_placement(placement, &pointer)?,
            name: name.to_owned(),
            schema,
        }),
        _ => None,
    };

    Ok(Some(Rule {
        id: RuleId::new(id.to_owned()),
        params,
        takes_bucket: access_rights_member(Some(declaration), "bucket")
            == Some(&JsonValue::Bool(true)),
        proof,
        errors: error_codes_of(access_rights_strings(Some(declaration), "errors")),
        docs: access_rights_docs(declaration).into(),
        extensions: access_rights_extensions(declaration),
        origin: access_rights_origin_of(context, &pointer)?,
    }))
}

/// The kinds of type use a proof cannot have: it is read and compared, never a file or opaque.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnreadableProofKind {
    File,
    Opaque,
}

fn unreadable_proof_kind(type_use: &TypeUse) -> Result<Option<UnreadableProofKind>, InternalError> {
    Ok(match KnownTypeUseRef::try_from(type_use)? {
        KnownTypeUseRef::File(_) => Some(UnreadableProofKind::File),
        KnownTypeUseRef::Opaque(_) => Some(UnreadableProofKind::Opaque),
        KnownTypeUseRef::Array(_)
        | KnownTypeUseRef::Scalar(_)
        | KnownTypeUseRef::Enum(_)
        | KnownTypeUseRef::Ref(_) => None,
    })
}

/// The scope a scope is within, as the merged raw tree writes it.
pub(crate) fn within_of<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    scope: &str,
) -> Option<&'run str> {
    let raw = context.context.raw;
    let scopes = access_rights_object(access_rights_member(Some(&raw.merged), "scopes"));

    access_rights_string(
        access_rights_object(access_rights_member(scopes, scope)),
        "within",
    )
}

/// Follows `within` from a scope up to a root scope: each parent must be declared, and the chain
/// never cycles.
pub(crate) fn within_chain_terminates(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    id: &str,
    scope_names: &HashSet<String>,
) -> Result<bool, InternalError> {
    let mut chain = vec![id.to_owned()];
    let mut parent = within_of(context, id);

    while let Some(name) = parent {
        if !scope_names.contains(name) {
            let last = chain.last().map_or(id, String::as_str);

            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::ScopeWithin,
                message: format!(
                    "scope '{last}' is within '{name}', which the scopes catalogue does not declare"
                ),
                fix: "declare the parent scope, or name a declared one in 'within'".to_owned(),
                pointer: pointer_below("/scopes", &[last, "within"]),
                distinct_by: None,
                related: Vec::new(),
            });

            return Ok(false);
        }

        if let Some(start) = chain.iter().position(|seen| seen == name) {
            report_within_cycle(reporter, chain.get(start..).unwrap_or_default())?;

            return Ok(false);
        }

        chain.push(name.to_owned());
        parent = within_of(context, name);
    }

    Ok(true)
}

// A cycle is reported once, at its first scope by name, whatever scope's chain reached it.
pub(crate) fn report_within_cycle(
    reporter: &mut AccessRightsReporter,
    cycle: &[String],
) -> Result<(), InternalError> {
    let mut sorted: Vec<&String> = cycle.iter().collect();

    sorted.sort_by(|left, right| cmp_utf16(left, right));

    let Some(first) = sorted.first() else {
        return Err(InternalError::new(
            "access.rights found an empty 'within' cycle".to_owned(),
        ));
    };
    let start = cycle.iter().position(|name| name == *first).unwrap_or(0);
    let mut path: Vec<&str> = cycle
        .iter()
        .skip(start)
        .chain(cycle.iter().take(start))
        .map(String::as_str)
        .collect();

    path.push(first);

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::ScopeWithin,
        message: format!(
            "scope '{first}' is within itself through {}",
            path.join(" -> ")
        ),
        fix: "remove the cycle from the scopes' 'within' chain".to_owned(),
        pointer: pointer_below("/scopes", &[first, "within"]),
        distinct_by: None,
        related: Vec::new(),
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::report::access_rights_reporter;

    use super::*;

    fn pattern_of(written: &str) -> AccessRightsRightPattern {
        AccessRightsRightPattern {
            pattern: Regex::with_flags(written, "u").unwrap(),
            source: regexp_source_of(written),
            pointer: RIGHT_PATTERN_POINTER.to_owned(),
        }
    }

    #[test]
    fn a_pattern_source_escapes_what_regexp_source_escapes() {
        for (written, source) in [
            ("", "(?:)"),
            ("a/b", "a\\/b"),
            ("a\\/b", "a\\/b"),
            ("[/]", "[/]"),
            ("\\[/", "\\[\\/"),
            ("a\nb", "a\\nb"),
        ] {
            assert_eq!(regexp_source_of(written), source, "pattern {written:?}");
        }
    }

    #[test]
    fn a_name_outside_the_pattern_and_one_without_a_segment_are_each_an_error() {
        let pattern = pattern_of("^[a-z]+$");
        let mut reporter = access_rights_reporter();
        let check = |id: &str, code_name: Option<&str>| AccessRightsNameCheck {
            id: id.to_owned(),
            code_name: code_name.map(str::to_owned),
            pointer: pointer_below("/rights", &[id]),
            right_pattern: Some(&pattern),
        };

        assert!(!access_rights_check_name(&mut reporter, &check("tasksRead", None)).unwrap());
        assert_eq!(reporter.errors(), 1);

        assert!(access_rights_check_name(&mut reporter, &check("read", None)).unwrap());
        assert_eq!(reporter.errors(), 1);

        assert!(!access_rights_check_name(&mut reporter, &check("read", Some("!!"))).unwrap());
        assert_eq!(reporter.errors(), 2);
    }

    #[test]
    fn a_right_without_errors_answers_the_forbidden_code() {
        assert_eq!(access_rights_right_errors(None, "forbidden"), ["forbidden"]);

        let mut declaration = JsonObject::new();

        declaration.insert("errors".to_owned(), JsonValue::Array(Vec::new()));

        assert_eq!(
            access_rights_right_errors(Some(&declaration), "forbidden"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_proof_is_placed_in_a_header_or_the_body_only() {
        assert_eq!(
            proof_placement("header", "/rules/r").unwrap(),
            ProofPlacement::Header
        );
        assert_eq!(
            proof_placement("body", "/rules/r").unwrap(),
            ProofPlacement::Body
        );
        assert!(proof_placement("query", "/rules/r").is_err());
    }
}
