//! The cache of an operation (ADR 0002 section 10, ADR 0006 section 5). `cache.headers`: an
//! inherited `cache` applies to GET routes; its `freshness` names a family of
//! `conventions.cache.families`, or `never` (no-store). `cache.etag`: the `ETag` header on every
//! success, the optional `If-None-Match` parameter and an empty 304 response carrying the `ETag`.
//! `cache.sensitive`: a response carrying a sensitive field is no-store; a sensitive value elsewhere
//! follows `conventions.cache.sensitiveElsewhere`.

use indexmap::map::Entry;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    Cache, CacheDirectives, CacheVisibility, CallerCacheControl, CallerKind, DerivedFrom,
    HttpMethod, KnownAccessRef, KnownSchemeRef, Layer, Origin, Response, ResponseHeader,
    ResponseShape, derivation_ids,
};
use seampact_json::JsonValue;
use seampact_pipeline::{
    ConventionReading, DerivedResponse, InheritedEntry, NearestSetting, ResponsePosition,
    SENSITIVE_ELSEWHERE_REFUSE, parse_duration,
};

use crate::concurrency::DERIVE_WIRE_ETAG;
use crate::credentials::{derive_wire_credential_place, derive_wire_scheme_of};
use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param,
    derive_wire_add_response_header, derive_wire_string_use, derive_wire_success_responses,
};
use crate::report::{DeriveWireProblem, DeriveWireRelated, DeriveWireRule};
use crate::routes::{
    DeriveWireRoute, DeriveWireScope, DeriveWireSettingFault, derive_wire_access_of,
    derive_wire_origin_at,
};
use crate::sensitive::{DeriveWireSensitiveValue, derive_wire_sensitive};

const NEVER: &str = "never";

const PUBLIC: &str = "public";

const MAX_AGE: &str = "maxAge";

const NOT_MODIFIED: i64 = 304;

const COOKIE_HEADER: &str = "Cookie";

const IF_NONE_MATCH: &str = "If-None-Match";

/// The `Cache-Control` value of a no-store response.
const NO_STORE: &str = "no-store";

const SECOND_MS: i64 = 1000;

/// What `reportSensitive` names: the family the cache writes and the sensitive value it would store.
#[derive(Debug, Clone, PartialEq)]
struct SensitiveFound<'found> {
    family: &'found str,
    sensitive: &'found DeriveWireSensitiveValue,
}

/// Writes the operation's `cache`, its `ETag` headers and 304 response, or the no-store a sensitive
/// field needs.
///
/// # Errors
///
/// An internal error from a reader or a writer.
pub(crate) fn derive_wire_cache(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let inherited = scope.context.inherited;
    let setting = inherited.nearest(route.node, &NearestSetting::Cache)?;
    let is_get = scope.operation_of(route.operation)?.method == Some(HttpMethod::Get);

    if let Some(setting) = &setting
        && !is_get
        && setting.node == route.node
    {
        report_method(route, setting, scope)?;

        return Ok(());
    }

    let sensitive = no_store_value(route, scope)?;

    let (Some(setting), true) = (setting, is_get) else {
        if let Some(sensitive) = &sensitive {
            let cache = sensitive_no_store(route, sensitive, scope)?;

            scope.output_of(route.operation)?.cache = Some(cache);
        }

        return Ok(());
    };

    let Some(written) = cache_of(route, &setting, sensitive.as_ref(), scope)? else {
        return Ok(());
    };
    let etag = written.etag;

    scope.output_of(route.operation)?.cache = Some(written);

    if etag {
        write_entity_tag(route, &setting.origin, scope)?;
    }

    Ok(())
}

// The sensitive value that makes the operation no-store: its first field, else its first value
// elsewhere unless the convention refuses that value, which is then reported. Only the route's
// first value elsewhere is reported; the next one appears once it is fixed.
fn no_store_value(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<Option<DeriveWireSensitiveValue>, InternalError> {
    let sensitive = derive_wire_sensitive(route, scope)?;
    let Some(elsewhere) = sensitive.elsewhere else {
        return Ok(sensitive.field);
    };
    let policy = scope.context.conventions.get("cache.sensitiveElsewhere")?;
    let refused = matches!(
        policy.as_ref().map(|reading| reading.value),
        Some(JsonValue::String(text)) if text == SENSITIVE_ELSEWHERE_REFUSE
    );

    let (true, Some(policy)) = (refused, policy) else {
        return Ok(sensitive.field.or(Some(elsewhere)));
    };

    report_elsewhere(route, &elsewhere, &policy, scope)?;

    Ok(sensitive.field)
}

fn cache_of(
    route: &DeriveWireRoute,
    setting: &InheritedEntry<'_>,
    sensitive: Option<&DeriveWireSensitiveValue>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<Option<Cache>, InternalError> {
    let JsonValue::Object(value) = setting.value else {
        return Err(InternalError::new(format!(
            "cache at {} is no mapping, which the authoring schema refuses",
            setting.origin.pointer
        )));
    };

    let Some(JsonValue::String(family)) = value.get("freshness") else {
        report_freshness(route, setting, scope)?;

        return Ok(None);
    };

    if family != NEVER
        && let Some(sensitive) = sensitive
    {
        report_sensitive(route, setting, &SensitiveFound { family, sensitive }, scope)?;

        return Ok(None);
    }

    let directives = if family == NEVER {
        None
    } else {
        let Some(directives) = directives_of(route, family, setting, scope)? else {
            return Ok(None);
        };

        Some(directives)
    };
    let anonymous = match value.get("anonymous") {
        Some(JsonValue::String(text)) if text == PUBLIC => CacheVisibility::Public,
        _ => CacheVisibility::Private,
    };
    let mut from = vec![setting.origin.clone()];

    if directives.is_some() {
        from.push(derive_wire_origin_at(
            scope,
            &format!("/conventions/cache/families/{family}"),
        )?);
    }

    // `freshness: never` over a sensitive field is the no-store `cache.sensitive` derives, from both.
    if let Some(sensitive) = sensitive {
        from.push(sensitive.origin.clone());
    }

    let per_caller_kind = caller_kinds_of(route, scope)?
        .into_iter()
        .map(|caller| {
            let shared = caller == CallerKind::Anonymous && anonymous == CacheVisibility::Public;

            CallerCacheControl {
                caller,
                cache_control: cache_control_of(directives.as_ref(), shared),
            }
        })
        .collect();
    let derivation = if sensitive.is_none() {
        derivation_ids::CACHE_HEADERS
    } else {
        derivation_ids::CACHE_SENSITIVE
    };

    Ok(Some(Cache {
        family: family.clone(),
        no_store: directives.is_none(),
        directives,
        anonymous,
        vary: vary_of(route, value.get("vary"), scope)?,
        etag: matches!(value.get("etag"), Some(JsonValue::Bool(true))),
        per_caller_kind,
        origin: setting.origin.clone(),
        derived_from: Some(DerivedFrom { derivation, from }),
    }))
}

fn sensitive_no_store(
    route: &DeriveWireRoute,
    sensitive: &DeriveWireSensitiveValue,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Cache, InternalError> {
    let per_caller_kind = caller_kinds_of(route, scope)?
        .into_iter()
        .map(|caller| CallerCacheControl {
            caller,
            cache_control: NO_STORE.to_owned(),
        })
        .collect();

    Ok(Cache {
        family: NEVER.to_owned(),
        directives: None,
        anonymous: CacheVisibility::Private,
        vary: Vec::new(),
        etag: false,
        per_caller_kind,
        no_store: true,
        origin: sensitive.origin.clone(),
        derived_from: Some(DerivedFrom {
            derivation: derivation_ids::CACHE_SENSITIVE,
            from: vec![sensitive.origin.clone()],
        }),
    })
}

// A family is a max-age (`60s`) or a mapping of directives in camel case; durations become
// milliseconds.
fn directives_of(
    route: &DeriveWireRoute,
    family: &str,
    setting: &InheritedEntry<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<Option<CacheDirectives>, InternalError> {
    let path = format!("cache.families.{family}");
    let Some(reading) = scope.context.conventions.get(&path)? else {
        report_family(
            route,
            setting,
            &format!(
                "names the family '{family}', which conventions.cache.families does not declare"
            ),
            scope,
        )?;

        return Ok(None);
    };
    let written = reading.value;
    let Some(max_age_ms) = duration_of(written, "maxAge", family)? else {
        report_family(
            route,
            setting,
            &format!("names the family '{family}', which sets no maxAge"),
            scope,
        )?;

        return Ok(None);
    };

    Ok(Some(CacheDirectives {
        max_age_ms,
        shared_max_age_ms: duration_of(written, "sharedMaxAge", family)?,
        stale_while_revalidate_ms: duration_of(written, "staleWhileRevalidate", family)?,
        stale_if_error_ms: duration_of(written, "staleIfError", family)?,
        immutable: flag_of(written, "immutable"),
        no_cache: flag_of(written, "noCache"),
        must_revalidate: flag_of(written, "mustRevalidate"),
    }))
}

// The member of a family: a bare value is the family's `maxAge`.
fn family_member<'written>(written: &'written JsonValue, key: &str) -> Option<&'written JsonValue> {
    match written {
        JsonValue::Object(members) => members.get(key),
        bare => (key == MAX_AGE).then_some(bare),
    }
}

fn duration_of(written: &JsonValue, key: &str, family: &str) -> Result<Option<i64>, InternalError> {
    let Some(member) = family_member(written, key) else {
        return Ok(None);
    };
    let milliseconds = match member {
        JsonValue::String(text) => parse_duration(text)?.and_then(|ms| i64::try_from(ms).ok()),
        _ => None,
    };

    milliseconds.map(Some).ok_or_else(|| {
        InternalError::new(format!(
            "conventions.cache.families.{family}.{key} is no duration, which the authoring schema refuses"
        ))
    })
}

fn flag_of(written: &JsonValue, key: &str) -> bool {
    matches!(family_member(written, key), Some(JsonValue::Bool(true)))
}

// The `Cache-Control` value; `shared` adds the shared-cache directives of a public value.
fn cache_control_of(directives: Option<&CacheDirectives>, shared: bool) -> String {
    let Some(directives) = directives else {
        return NO_STORE.to_owned();
    };
    let seconds = |ms: i64| ms.div_euclid(SECOND_MS);
    let mut parts = vec![
        if shared { "public" } else { "private" }.to_owned(),
        format!("max-age={}", seconds(directives.max_age_ms)),
    ];

    if shared && let Some(ms) = directives.shared_max_age_ms {
        parts.push(format!("s-maxage={}", seconds(ms)));
    }

    if let Some(ms) = directives.stale_while_revalidate_ms {
        parts.push(format!("stale-while-revalidate={}", seconds(ms)));
    }

    if let Some(ms) = directives.stale_if_error_ms {
        parts.push(format!("stale-if-error={}", seconds(ms)));
    }

    for (set, text) in [
        (directives.immutable, "immutable"),
        (directives.no_cache, "no-cache"),
        (directives.must_revalidate, "must-revalidate"),
    ] {
        if set {
            parts.push(text.to_owned());
        }
    }

    parts.join(", ")
}

fn caller_kinds_of(
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Vec<CallerKind>, InternalError> {
    Ok(match derive_wire_access_of(scope, route)? {
        KnownAccessRef::Public(_) => vec![CallerKind::Anonymous],
        KnownAccessRef::Identity(_) => vec![CallerKind::Identified],
        KnownAccessRef::Optional(_) => vec![CallerKind::Anonymous, CallerKind::Identified],
    })
}

// The credential headers of the accepted schemes (a query credential varies the URL itself), then
// `cache.vary`, each name once, compared case-insensitively.
fn vary_of(
    route: &DeriveWireRoute,
    written: Option<&JsonValue>,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Vec<String>, InternalError> {
    let mut names: Vec<String> = Vec::new();
    let scheme_ids = match derive_wire_access_of(scope, route)? {
        KnownAccessRef::Public(_) => &[],
        KnownAccessRef::Identity(access) => access.schemes.as_slice(),
        KnownAccessRef::Optional(access) => access.schemes.as_slice(),
    };

    for id in scheme_ids {
        let scheme = derive_wire_scheme_of(id.as_str(), scope)?;
        let place = derive_wire_credential_place(scheme)?;

        if matches!(scheme, KnownSchemeRef::Cookie(_)) {
            add_vary_name(&mut names, COOKIE_HEADER);
        } else if let Some(place) = place
            && place.place == DeriveWireParamPlace::Header
        {
            add_vary_name(&mut names, &place.name);
        }
    }

    if let Some(JsonValue::Array(listed)) = written {
        for item in listed {
            if let JsonValue::String(name) = item {
                add_vary_name(&mut names, name);
            }
        }
    }

    Ok(names)
}

fn add_vary_name(names: &mut Vec<String>, name: &str) {
    let lowered = name.to_lowercase();

    if !names.iter().any(|known| known.to_lowercase() == lowered) {
        names.push(name.to_owned());
    }
}

// A response of an item versioned by `If-Match` already carries the tag `cache.etag` uses.
fn is_version_tag(header: &ResponseHeader) -> bool {
    header.name == DERIVE_WIRE_ETAG
        && header
            .derived_from
            .as_ref()
            .is_some_and(|record| record.derivation == derivation_ids::CONCURRENCY_VERSION)
}

fn write_entity_tag(
    route: &DeriveWireRoute,
    origin: &Origin,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let derived = |name: &str, required: bool| DeriveWireDerived {
        name: name.to_owned(),
        r#type: derive_wire_string_use(),
        required,
        derived_from: DerivedFrom {
            derivation: derivation_ids::CACHE_ETAG,
            from: vec![origin.clone()],
        },
        wire: None,
    };
    let entity_tag = derived(DERIVE_WIRE_ETAG, true);
    let responses = scope.responses_of(route.operation)?;

    for position in derive_wire_success_responses(route, scope)? {
        let carries_version_tag = responses
            .get(position)
            .is_some_and(|response| response.headers.iter().any(is_version_tag));

        if !carries_version_tag {
            derive_wire_add_response_header(route, position, &entity_tag, None, scope)?;
        }
    }

    derive_wire_add_param(
        route,
        DeriveWireParamPlace::Header,
        derived(IF_NONE_MATCH, false),
        scope,
    )?;

    let position = responses
        .iter()
        .position(|response| response.status > NOT_MODIFIED)
        .map_or(ResponsePosition::End, ResponsePosition::At);
    let not_modified = Response {
        status: NOT_MODIFIED,
        media: None,
        body: None,
        shape: ResponseShape::Empty,
        headers: vec![ResponseHeader {
            name: entity_tag.name,
            r#type: entity_tag.r#type,
            required: true,
            semantic: None,
            origin: None,
            derived_from: Some(entity_tag.derived_from.clone()),
        }],
        origin: None,
        derived_from: Some(entity_tag.derived_from),
        docs: None,
    };

    scope.add_derived_response(
        route.operation,
        DerivedResponse {
            position,
            response: not_modified,
        },
    )
}

fn report_method(
    route: &DeriveWireRoute,
    setting: &InheritedEntry<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let method = scope
        .operation_of(route.operation)?
        .method
        .as_ref()
        .map_or_else(
            || "undefined".to_owned(),
            |method| method.as_str().to_uppercase(),
        );

    scope.reporter().error(DeriveWireProblem {
        rule: DeriveWireRule::CacheMethod,
        message: format!(
            "operation '{}' is a {method} route and declares cache, which applies to GET routes only",
            route.id
        ),
        fix: "Remove cache from the route, or declare it on a GET route.".to_owned(),
        pointer: setting.origin.pointer.clone(),
        related: Vec::new(),
    })
}

fn report_family(
    route: &DeriveWireRoute,
    setting: &InheritedEntry<'_>,
    what: &str,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let problem = DeriveWireProblem {
        rule: DeriveWireRule::CacheFamily,
        message: format!("cache {what}"),
        fix: "Name a family declared in conventions.cache.families with its maxAge, or freshness: never.".to_owned(),
        pointer: setting.origin.pointer.clone(),
        related: Vec::new(),
    };
    let key = format!(
        "{} {} {}",
        problem.rule.name(),
        problem.pointer,
        problem.message
    );

    add_setting_fault(key, problem, route, scope)
}

fn report_freshness(
    route: &DeriveWireRoute,
    setting: &InheritedEntry<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let problem = DeriveWireProblem {
        rule: DeriveWireRule::CacheFreshness,
        message: "cache gives no freshness, so no Cache-Control can be derived from it".to_owned(),
        fix: "Write freshness: a family of conventions.cache.families, or never.".to_owned(),
        pointer: setting.origin.pointer.clone(),
        related: Vec::new(),
    };
    let key = format!("{} {}", problem.rule.name(), problem.pointer);

    add_setting_fault(key, problem, route, scope)
}

fn report_sensitive(
    route: &DeriveWireRoute,
    setting: &InheritedEntry<'_>,
    found: &SensitiveFound<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let SensitiveFound { family, sensitive } = found;
    let problem = DeriveWireProblem {
        rule: DeriveWireRule::CacheSensitive,
        message: format!(
            "cache family '{family}' would store {}, which the routes it reaches answer",
            sensitive.text
        ),
        fix: "Drop cache or sensitive, or write freshness: never.".to_owned(),
        pointer: setting.origin.pointer.clone(),
        related: vec![DeriveWireRelated {
            pointer: sensitive.origin.pointer.clone(),
            message: "the sensitive value".to_owned(),
        }],
    };
    let key = format!(
        "{} {} {}",
        problem.rule.name(),
        problem.pointer,
        sensitive.origin.pointer
    );

    add_setting_fault(key, problem, route, scope)
}

fn report_elsewhere(
    route: &DeriveWireRoute,
    elsewhere: &DeriveWireSensitiveValue,
    policy: &ConventionReading<'_>,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    // A derived header has a core origin: the route that answers it locates the fault.
    let pointer = if elsewhere.origin.layer == Layer::Core {
        scope.node_of(route)?.pointer.clone()
    } else {
        elsewhere.origin.pointer.clone()
    };
    let related = policy
        .origin
        .iter()
        .map(|origin| DeriveWireRelated {
            pointer: origin.pointer.clone(),
            message: "the convention".to_owned(),
        })
        .collect();
    let problem = DeriveWireProblem {
        rule: DeriveWireRule::CacheSensitiveElsewhere,
        message: format!(
            "conventions.cache.sensitiveElsewhere is refuse, so no route may answer {}",
            elsewhere.text
        ),
        fix: "Answer the value in a property of the body, drop its sensitive mark, or set conventions.cache.sensitiveElsewhere: noStore.".to_owned(),
        pointer: pointer.clone(),
        related,
    };
    let key = format!("{} {pointer}", problem.rule.name());

    add_setting_fault(key, problem, route, scope)
}

// An inherited cache reaches every GET route below it: its fault is reported once, naming each
// route it reaches.
fn add_setting_fault(
    key: String,
    problem: DeriveWireProblem,
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let route_related = DeriveWireRelated {
        pointer: scope.node_of(route)?.pointer.clone(),
        message: "a route it reaches".to_owned(),
    };

    match scope.setting_faults.entry(key) {
        Entry::Vacant(vacant) => {
            vacant.insert(DeriveWireSettingFault {
                problem,
                routes: vec![route_related],
            });
        }
        Entry::Occupied(mut occupied) => {
            let routes = &mut occupied.get_mut().routes;

            if !routes
                .iter()
                .any(|reached| reached.pointer == route_related.pointer)
            {
                routes.push(route_related);
            }
        }
    }

    Ok(())
}

/// Reports each fault of an inherited setting once, the routes it reaches first in `related`.
///
/// # Errors
///
/// An internal error when a fault's pointer has no authored origin.
pub(crate) fn derive_wire_report_setting_faults(
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), seampact_diagnostics::InternalError> {
    let faults = std::mem::take(&mut scope.setting_faults);

    for (_, fault) in faults {
        let mut related = fault.routes;

        related.extend(fault.problem.related);

        scope.reporter().error(DeriveWireProblem {
            related,
            ..fault.problem
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

    fn directives(max_age_ms: i64, shared_max_age_ms: Option<i64>) -> CacheDirectives {
        CacheDirectives {
            max_age_ms,
            shared_max_age_ms,
            stale_while_revalidate_ms: None,
            stale_if_error_ms: None,
            immutable: false,
            no_cache: false,
            must_revalidate: false,
        }
    }

    #[test]
    fn seconds_are_the_floor_of_the_milliseconds_as_number_text() {
        for (milliseconds, seconds) in [
            (0, "0"),
            (999, "0"),
            (1000, "1"),
            (1999, "1"),
            (MAX_SAFE_INTEGER, "9007199254740"),
        ] {
            assert_eq!(
                cache_control_of(Some(&directives(milliseconds, None)), false),
                format!("private, max-age={seconds}"),
                "{milliseconds} ms"
            );
        }
    }

    #[test]
    fn a_public_value_adds_the_shared_directive_and_a_missing_one_is_no_store() {
        assert_eq!(
            cache_control_of(Some(&directives(60_000, Some(120_000))), true),
            "public, max-age=60, s-maxage=120"
        );
        assert_eq!(
            cache_control_of(Some(&directives(60_000, Some(120_000))), false),
            "private, max-age=60"
        );
        assert_eq!(cache_control_of(None, true), NO_STORE);
    }

    #[test]
    fn a_vary_name_is_kept_once_whatever_its_case() {
        let mut names = vec!["Cookie".to_owned()];

        add_vary_name(&mut names, "COOKIE");
        add_vary_name(&mut names, "ΟΔΟΣ");
        add_vary_name(&mut names, "οδος");

        assert_eq!(names, ["Cookie", "ΟΔΟΣ"]);
    }

    #[test]
    fn a_bare_family_is_a_max_age_and_an_object_one_reads_its_members() {
        let bare = JsonValue::String("60s".to_owned());

        assert_eq!(duration_of(&bare, "maxAge", "short").unwrap(), Some(60_000));
        assert_eq!(duration_of(&bare, "sharedMaxAge", "short").unwrap(), None);
        assert!(!flag_of(&bare, "immutable"));

        let not_a_duration = JsonValue::Bool(true);

        assert!(duration_of(&not_a_duration, "maxAge", "short").is_err());
    }
}
