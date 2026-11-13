//! The half outputs against the field-ownership table of ADR 0006 section 3.

use seampact_pipeline::{
    AccessIdentityOutput, AccessRightsOutput, DeriveErrorsOutput, DeriveWireOutput, Half, PassName,
    TreeNodesOutput, TreeSchemasMembers,
};

use crate::support::repository_root;

/// The marker that starts the per-operation members of a pass row.
const PER_OPERATION_MARKER: &str = "per operation:";

/// The prefix of a per-operation field in a normalised path.
const OPERATION_PREFIX: &str = "operations[].";

/// Mentions that are no member the pass writes, each with its reason.
const NOT_MEMBERS: [(PassName, &str); 2] = [
    (PassName::Derive, "conventions.input.unknownKeys"),
    (PassName::Derive, "input.unknownKeys"),
];

/// Mentions that name a member by another word than its path.
const ALIASES: [(PassName, &str, &str); 4] = [
    (PassName::Tree, "fields", "operations[].input.fields"),
    (PassName::Tree, "shape", "operations[].responses"),
    (
        PassName::Access,
        "unknownKeys",
        "operations[].input.schema.unknownKeys",
    ),
    (
        PassName::Derive,
        "unknownKeys",
        "operations[].input.schema.unknownKeys",
    ),
];

/// Fields a pass writes that its ADR row does not mention, each with its reason.
const UNMENTIONED: [(PassName, &str); 5] = [
    (PassName::Tree, "operations[].kind"),
    (
        PassName::Access,
        "operations[].paging.sortKeys[].derivedFrom",
    ),
    (PassName::Access, "operations[].paging.sortKeys[].params"),
    (PassName::Access, "operations[].paging.sortKeys[].subject"),
    (PassName::Derive, "api.wire"),
];

fn writes_of(half: Half) -> &'static [&'static str] {
    match half {
        Half::TreeSchemas => TreeSchemasMembers::WRITES,
        Half::TreeNodes => TreeNodesOutput::WRITES,
        Half::AccessIdentity => AccessIdentityOutput::WRITES,
        Half::AccessRights => AccessRightsOutput::WRITES,
        Half::DeriveWire => DeriveWireOutput::WRITES,
        Half::DeriveErrors => DeriveErrorsOutput::WRITES,
    }
}

fn pass_writes(pass: PassName) -> Vec<&'static str> {
    Half::RUN_ORDER
        .into_iter()
        .filter(|half| half.pass() == pass)
        .flat_map(writes_of)
        .copied()
        .collect()
}

/// The segments of a normalised path: `operations[].requires` is `operations`, `[]`, `requires`.
fn segments(field: &str) -> Vec<&str> {
    let mut found = Vec::new();

    for part in field.split('.') {
        let name = part.strip_suffix("[]").unwrap_or(part);

        if !name.is_empty() {
            found.push(name);
        }

        if part.ends_with("[]") {
            found.push("[]");
        }
    }

    found
}

fn is_prefix(prefix: &[&str], whole: &[&str]) -> bool {
    prefix.len() <= whole.len() && prefix.iter().zip(whole).all(|(left, right)| left == right)
}

/// The backticked mentions of a row cell, each with its position.
fn mentions(cell: &str) -> Vec<(usize, &str)> {
    let mut found = Vec::new();
    let mut rest = cell;
    let mut offset = 0;

    while let Some(open) = rest.find('`') {
        let after_open = open + 1;
        let Some(length) = rest.get(after_open..).and_then(|tail| tail.find('`')) else {
            break;
        };
        let token = rest
            .get(after_open..after_open + length)
            .unwrap_or_default();

        found.push((offset + open, token));
        offset += after_open + length + 1;
        rest = rest.get(after_open + length + 1..).unwrap_or_default();
    }

    found
}

fn adr_pass_cells() -> Result<Vec<(PassName, String)>, String> {
    let path = repository_root().join("docs/adr/0006-compiler-pass-pipeline.md");
    let adr = std::fs::read_to_string(&path).map_err(|failure| failure.to_string())?;
    let start = adr
        .find("### 3. Field ownership")
        .ok_or("ADR 0006 has no section 3")?;
    let mut cells = Vec::new();

    for line in adr.get(start..).unwrap_or_default().lines().skip(4) {
        if !line.starts_with('|') {
            break;
        }

        let inner = line.trim_start_matches('|').trim_end_matches('|');
        let Some((pass, writes)) = inner.split_once(" | ") else {
            continue;
        };
        let pass = match pass.trim() {
            "tree" => PassName::Tree,
            "access" => PassName::Access,
            "derive" => PassName::Derive,
            _ => continue,
        };

        cells.push((pass, writes.trim().to_owned()));
    }

    Ok(cells)
}

fn mentioned_fields(pass: PassName, cell: &str) -> Vec<String> {
    let split = cell.find(PER_OPERATION_MARKER).unwrap_or(usize::MAX);
    let mut fields = Vec::new();

    for (position, token) in mentions(cell) {
        if NOT_MEMBERS.contains(&(pass, token)) {
            continue;
        }

        let alias = ALIASES
            .iter()
            .find(|(aliased, word, _)| *aliased == pass && *word == token);

        fields.push(match alias {
            Some((_, _, path)) => (*path).to_owned(),
            None if position > split => format!("{OPERATION_PREFIX}{token}"),
            None => token.to_owned(),
        });
    }

    fields
}

#[test]
fn the_outputs_match_the_ownership_table_of_adr_0006() -> Result<(), String> {
    let cells = adr_pass_cells()?;
    let passes: Vec<PassName> = cells.iter().map(|(pass, _)| *pass).collect();

    assert_eq!(passes, [PassName::Tree, PassName::Access, PassName::Derive]);

    for (pass, cell) in &cells {
        let writes = pass_writes(*pass);
        let mentioned = mentioned_fields(*pass, cell);

        assert!(!mentioned.is_empty(), "{pass}: no mention found");

        for field in &mentioned {
            let wanted = segments(field);

            assert!(
                writes
                    .iter()
                    .any(|write| is_prefix(&wanted, &segments(write))),
                "{pass} writes {field} in ADR 0006, but no half of the pass does"
            );
        }

        for write in &writes {
            if UNMENTIONED.contains(&(*pass, *write)) {
                continue;
            }

            let written = segments(write);

            assert!(
                mentioned
                    .iter()
                    .any(|field| is_prefix(&segments(field), &written)),
                "{write} ({pass}) is not in ADR 0006's {pass} row"
            );
        }
    }

    Ok(())
}

#[test]
fn every_half_has_writes_and_no_field_has_two_owners_but_defaults_and_lists() {
    let shared: [&str; 12] = [
        "operations[].maturity",
        "operations[].input.schema.unknownKeys",
        "operations[].input.rawBody",
        "operations[].input.media",
        "operations[].input.schema",
        "operations[].input.origin",
        "operations[].params.header",
        "operations[].params.path",
        "operations[].params.query",
        "operations[].responses",
        "operations[].responses[].headers",
        "operations[].input",
    ];
    let mut seen: Vec<(&str, Half)> = Vec::new();

    for half in Half::RUN_ORDER {
        assert!(!writes_of(half).is_empty(), "{half}");

        for field in writes_of(half) {
            if shared.contains(field) {
                continue;
            }

            let owner = seen.iter().find(|(seen_field, _)| seen_field == field);

            assert!(owner.is_none(), "{field}: {half} and {owner:?}");
            seen.push((field, half));
        }
    }
}
