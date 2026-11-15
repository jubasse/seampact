//! The cache of an operation (ADR 0002 section 10, ADR 0006 section 5). `cache.headers`: an
//! inherited `cache` applies to GET routes; its `freshness` names a family of
//! `conventions.cache.families`, or `never` (no-store). `cache.etag`: the `ETag` header on every
//! success, the optional `If-None-Match` parameter and an empty 304 response carrying the `ETag`.
//! `cache.sensitive`: a response carrying a sensitive field is no-store; a sensitive value elsewhere
//! follows `conventions.cache.sensitiveElsewhere`.

use seampact_ir::{Cache, CacheDirectives, CallerKind, HttpMethod, Origin, ResponseHeader};
use seampact_json::JsonValue;
use seampact_pipeline::{
    ConventionReading, InheritedEntry, NearestSetting, PassError, SENSITIVE_ELSEWHERE_REFUSE,
};

use crate::not_ported::not_ported_yet;
use crate::report::DeriveWireProblem;
use crate::routes::{DeriveWireRoute, DeriveWireScope};
use crate::sensitive::{DeriveWireSensitiveValue, derive_wire_sensitive};

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
/// An internal error from a reader, or [`PassError::NotPortedYet`] until the cache writers are
/// ported.
pub(crate) fn derive_wire_cache(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
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
) -> Result<Option<DeriveWireSensitiveValue>, PassError> {
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
    _route: &DeriveWireRoute,
    _setting: &InheritedEntry<'_>,
    _sensitive: Option<&DeriveWireSensitiveValue>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<Option<Cache>, PassError> {
    Err(not_ported_yet("cacheOf"))
}

fn sensitive_no_store(
    _route: &DeriveWireRoute,
    _sensitive: &DeriveWireSensitiveValue,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Cache, PassError> {
    Err(not_ported_yet("sensitiveNoStore"))
}

// A family is a max-age (`60s`) or a mapping of directives in camel case; durations become
// milliseconds.
fn directives_of(
    _route: &DeriveWireRoute,
    _family: &str,
    _setting: &InheritedEntry<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<Option<CacheDirectives>, PassError> {
    Err(not_ported_yet("directivesOf"))
}

// The `Cache-Control` value; `shared` adds the shared-cache directives of a public value.
fn cache_control_of(
    _directives: Option<&CacheDirectives>,
    _shared: bool,
) -> Result<String, PassError> {
    Err(not_ported_yet("cacheControlOf"))
}

fn caller_kinds_of(
    _route: &DeriveWireRoute,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Vec<CallerKind>, PassError> {
    Err(not_ported_yet("callerKindsOf"))
}

// The credential headers of the accepted schemes (a query credential varies the URL itself), then
// `cache.vary`, each name once, compared case-insensitively.
fn vary_of(
    _route: &DeriveWireRoute,
    _written: Option<&JsonValue>,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("varyOf"))
}

// A response of an item versioned by `If-Match` already carries the tag `cache.etag` uses.
fn is_version_tag(_header: &ResponseHeader) -> Result<bool, PassError> {
    Err(not_ported_yet("isVersionTag"))
}

fn write_entity_tag(
    _route: &DeriveWireRoute,
    _origin: &Origin,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeEntityTag"))
}

fn report_method(
    _route: &DeriveWireRoute,
    _setting: &InheritedEntry<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportMethod"))
}

fn report_family(
    _route: &DeriveWireRoute,
    _setting: &InheritedEntry<'_>,
    _what: &str,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportFamily"))
}

fn report_freshness(
    _route: &DeriveWireRoute,
    _setting: &InheritedEntry<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportFreshness"))
}

fn report_sensitive(
    _route: &DeriveWireRoute,
    _setting: &InheritedEntry<'_>,
    _found: &SensitiveFound<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSensitive"))
}

fn report_elsewhere(
    _route: &DeriveWireRoute,
    _elsewhere: &DeriveWireSensitiveValue,
    _policy: &ConventionReading<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportElsewhere"))
}

// An inherited cache reaches every GET route below it: its fault is reported once, naming each
// route it reaches.
fn add_setting_fault(
    _key: &str,
    _problem: DeriveWireProblem,
    _route: &DeriveWireRoute,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addSettingFault"))
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
