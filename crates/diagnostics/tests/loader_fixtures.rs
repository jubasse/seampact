//! Order and printed text against the oracle: each loader fixture with an `expected.txt` whose
//! diagnostics all sit at load sites. A site pointer (`/~load/<file>/<line>/<column>`) holds
//! its own position, so the location table is rebuilt from it without the loader.

use std::fs;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, RelatedLocation, RuleId, Severity,
    diagnostic_location_key, diagnostic_sort, print_diagnostics,
};
use seampact_span::Location;
use serde_json::Value;

const SITE_POINTER_PREFIX: &str = "/~load/";
const PACK_LAYER_PREFIX: &str = "pack:";

type TestResult<T> = Result<T, String>;

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn expected_texts(directory: &Path, found: &mut Vec<PathBuf>) -> TestResult<()> {
    let entries =
        fs::read_dir(directory).map_err(|error| format!("{}: {error}", directory.display()))?;

    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();

        if path.is_dir() {
            expected_texts(&path, found)?;
        } else if path.file_name().is_some_and(|name| name == "expected.txt") {
            found.push(path);
        }
    }

    Ok(())
}

fn string_member<'value>(value: &'value Value, key: &str) -> TestResult<&'value str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("member '{key}' is not a string in {value}"))
}

fn layer(text: &str) -> TestResult<DiagnosticLayer> {
    match text {
        "api" => Ok(DiagnosticLayer::Api),
        "shared" => Ok(DiagnosticLayer::Shared),
        "base" => Ok(DiagnosticLayer::Base),
        "workspace" => Ok(DiagnosticLayer::Workspace),
        _ => text
            .strip_prefix(PACK_LAYER_PREFIX)
            .map(|name| DiagnosticLayer::Pack(name.to_owned()))
            .ok_or_else(|| format!("unknown layer '{text}'")),
    }
}

fn origin(value: &Value) -> TestResult<DiagnosticOrigin> {
    Ok(DiagnosticOrigin {
        api: value.get("api").and_then(Value::as_str).map(str::to_owned),
        layer: layer(string_member(value, "layer")?)?,
        pointer: string_member(value, "pointer")?.to_owned(),
    })
}

fn diagnostic(value: &Value) -> TestResult<Diagnostic> {
    let severity = match string_member(value, "severity")? {
        "error" => Severity::Error,
        "warning" => Severity::Warning,
        other => return Err(format!("unknown severity '{other}'")),
    };
    let related = value
        .get("related")
        .and_then(Value::as_array)
        .ok_or("member 'related' is not an array")?
        .iter()
        .map(|item| {
            Ok(RelatedLocation {
                origin: origin(item.get("origin").ok_or("related without an origin")?)?,
                message: string_member(item, "message")?.to_owned(),
            })
        })
        .collect::<TestResult<Vec<RelatedLocation>>>()?;

    Ok(Diagnostic {
        severity,
        rule: RuleId::new(string_member(value, "rule")?.to_owned()),
        message: string_member(value, "message")?.to_owned(),
        fix: string_member(value, "fix")?.to_owned(),
        origin: origin(value.get("origin").ok_or("diagnostic without an origin")?)?,
        related,
    })
}

// `/~load/<escaped file>/<line>/<column>`, the file escaped as a JSON pointer segment.
fn site_location(pointer: &str) -> Option<Location> {
    let rest = pointer.strip_prefix(SITE_POINTER_PREFIX)?;
    let mut segments = rest.split('/');
    let file = segments.next()?.replace("~1", "/").replace("~0", "~");
    let line: u32 = segments.next()?.parse().ok()?;
    let column: u32 = segments.next()?.parse().ok()?;

    if segments.next().is_some() {
        return None;
    }

    Some(Location {
        file,
        line,
        column,
        end_line: line,
        end_column: column,
    })
}

fn site_locations(diagnostics: &[Diagnostic]) -> Option<IndexMap<String, Location>> {
    let mut locations = IndexMap::new();

    for item in diagnostics {
        let origins = std::iter::once(&item.origin).chain(item.related.iter().map(|r| &r.origin));

        for at in origins {
            locations.insert(diagnostic_location_key(at), site_location(&at.pointer)?);
        }
    }

    Some(locations)
}

fn workspace_diagnostics(path: &Path) -> TestResult<Vec<Diagnostic>> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let document: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;

    document
        .get("workspace")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{} has no workspace array", path.display()))?
        .iter()
        .map(diagnostic)
        .collect()
}

fn check_fixture(root: &Path, expected_text: &Path) -> TestResult<bool> {
    let fixture = expected_text
        .parent()
        .and_then(|directory| directory.strip_prefix(root.join("fixtures")).ok())
        .ok_or_else(|| format!("{} is outside fixtures", expected_text.display()))?;
    let diagnostics_file = root
        .join("fixtures/expected")
        .join(fixture)
        .join("diagnostics.json");
    let in_compiler_order = workspace_diagnostics(&diagnostics_file)?;

    let Some(locations) = site_locations(&in_compiler_order) else {
        return Ok(false);
    };

    let mut reversed = in_compiler_order.clone();
    reversed.reverse();
    let sorted = diagnostic_sort(reversed, &locations);

    if sorted != in_compiler_order {
        return Err(format!(
            "{}: the sort differs from the compiler order",
            fixture.display()
        ));
    }

    let printed = format!("{}\n", print_diagnostics(&in_compiler_order, &locations));
    let expected = fs::read_to_string(expected_text)
        .map_err(|error| format!("{}: {error}", expected_text.display()))?;

    if printed != expected {
        return Err(format!(
            "{}: printed\n{printed}\nexpected\n{expected}",
            fixture.display()
        ));
    }

    Ok(true)
}

#[test]
fn loader_fixtures_sort_and_print_as_the_oracle() -> TestResult<()> {
    let root = repository_root();
    let mut found = Vec::new();

    expected_texts(&root.join("fixtures/loader"), &mut found)?;
    found.sort();

    let mut checked = 0;

    for expected_text in &found {
        if check_fixture(&root, expected_text)? {
            checked += 1;
        }
    }

    // Most loader goldens report at load sites only; a drop here means the walk broke.
    assert!(
        checked >= 20,
        "only {checked} of {} fixtures checked",
        found.len()
    );

    Ok(())
}
