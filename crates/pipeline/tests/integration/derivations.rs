//! The derivation table and the roles against ADR 0006 sections 5 and 6.

use seampact_ir::{ErrorRole, NatureBase, OPEN_ENUMS, ScalarType, TypeUse};
use seampact_pipeline::{
    DERIVATION_TABLE, DatumRequired, DerivationRoles, Half, IssueLocation, PACK_DERIVATION_ROW,
    RoleDatum, derivation_datum_always, derivation_issue_members, derivation_param_of_datum,
    derivation_params_schema_id, derivation_role_of, derivation_roles, derivation_row_of,
    is_derivation_id,
};

use crate::support::repository_root;

type Outcome = Result<(), String>;

/// The body rows of the first markdown table after `heading`, each split into its cells.
fn table_after(heading: &str) -> Result<Vec<Vec<String>>, String> {
    let path = repository_root().join("docs/adr/0006-compiler-pass-pipeline.md");
    let adr = std::fs::read_to_string(&path).map_err(|failure| failure.to_string())?;
    let start = adr.find(heading).ok_or(format!("no heading {heading}"))?;
    let lines: Vec<&str> = adr.get(start..).unwrap_or_default().lines().collect();
    let first = lines
        .iter()
        .position(|line| line.starts_with('|'))
        .ok_or("no table")?;

    Ok(lines
        .iter()
        .skip(first + 2)
        .take_while(|line| line.starts_with('|'))
        .map(|line| {
            line.trim_start_matches('|')
                .trim_end_matches('|')
                .split(" | ")
                .map(|cell| cell.trim().to_owned())
                .collect()
        })
        .collect())
}

fn ticked(cell: &str) -> Vec<&str> {
    cell.split('`').skip(1).step_by(2).collect()
}

fn role_names(roles: DerivationRoles) -> Vec<String> {
    match roles {
        DerivationRoles::Named(named) => {
            named.iter().map(|role| role.as_str().to_owned()).collect()
        }
        DerivationRoles::Declared => vec!["declared".to_owned()],
        DerivationRoles::None => vec!["none".to_owned()],
    }
}

fn cell_at(row: &[String], index: usize) -> Result<&str, String> {
    row.get(index)
        .map(String::as_str)
        .ok_or_else(|| format!("a row with no cell {index}: {row:?}"))
}

#[test]
fn the_derivation_table_matches_adr_0006() -> Outcome {
    let rows = table_after("### 5. The derivation table")?;
    let from_adr: Vec<(String, Vec<String>)> = rows
        .iter()
        .map(|row| {
            let id = ticked(cell_at(row, 0)?)
                .first()
                .copied()
                .unwrap_or_default();
            let role = cell_at(row, 3)?;
            let roles = if role == "declared" || role == "none" {
                vec![role.to_owned()]
            } else {
                ticked(role).into_iter().map(str::to_owned).collect()
            };

            Ok((id.to_owned(), roles))
        })
        .collect::<Result<_, String>>()?;
    let from_table: Vec<(String, Vec<String>)> = DERIVATION_TABLE
        .iter()
        .map(|row| (row.id.to_owned(), role_names(row.roles)))
        .collect();

    assert!(from_adr.len() > 40, "{}", from_adr.len());
    assert_eq!(from_table, from_adr);

    Ok(())
}

#[test]
fn the_table_keeps_the_order_of_the_adr_and_unique_ids() {
    let ids: Vec<&str> = DERIVATION_TABLE.iter().map(|row| row.id).collect();
    let mut sorted = ids.clone();

    sorted.sort_unstable();
    sorted.dedup();

    assert_eq!(sorted.len(), ids.len(), "a derivation id appears twice");
    assert_eq!(ids.first(), Some(&"input.invalid"));
    assert_eq!(ids.get(1), Some(&"body.limit"));
    assert_eq!(ids.last(), Some(&PACK_DERIVATION_ROW));
    assert_ne!(ids, {
        let mut by_name = ids.clone();

        by_name.sort_unstable();
        by_name
    });
}

#[test]
fn every_owner_column_names_a_half_and_every_row_derives_something() {
    for row in DERIVATION_TABLE {
        if let Some(half) = row.wire {
            assert_eq!(Half::from_name(half.as_str()), Some(half), "{}", row.id);
        }

        assert!(
            row.roles != DerivationRoles::None || row.wire.is_some(),
            "{} derives nothing",
            row.id
        );
    }
}

#[test]
fn every_role_named_in_the_table_exists() {
    for row in DERIVATION_TABLE {
        let DerivationRoles::Named(roles) = row.roles else {
            continue;
        };

        for role in roles {
            assert!(derivation_role_of(role).is_some(), "{}: {role}", row.id);
        }
    }
}

#[test]
fn a_derivation_id_is_a_table_id_or_a_pack_entry() {
    for row in DERIVATION_TABLE {
        assert_eq!(
            is_derivation_id(row.id),
            row.id != PACK_DERIVATION_ROW,
            "{}",
            row.id
        );
    }

    assert!(is_derivation_id("pack.@seampact/pack-crud-rights.owner"));
    assert!(is_derivation_id("pack.house.v2.audit"));
    assert_eq!(
        derivation_row_of("pack.house.audit").and_then(|row| row.wire),
        Some(Half::AccessRights)
    );

    for id in [
        "pack.house",
        "pack..x",
        "pack.house.",
        "pack.a b.c",
        "pack.a.\u{feff}",
        "pack.a.b\n",
        "body",
        "",
        PACK_DERIVATION_ROW,
    ] {
        assert!(!is_derivation_id(id), "{id:?}");
        assert!(derivation_row_of(id).is_none(), "{id:?}");
    }
}

#[test]
fn a_pack_entry_may_hold_non_ascii_and_astral_names() {
    assert!(is_derivation_id("pack.caf\u{e9}.\u{1f600}"));
    // U+0085 is no ECMAScript white space, U+2028 is.
    assert!(is_derivation_id("pack.a\u{85}.b"));
    assert!(!is_derivation_id("pack.a\u{2028}.b"));
}

#[test]
fn the_roles_match_adr_0006() -> Outcome {
    let rows = table_after("### 6. Roles and their default codes")?;

    assert_eq!(rows.len(), 20);
    assert_eq!(derivation_roles().len(), 20);

    for (adr, role) in rows.iter().zip(derivation_roles()) {
        let name = ticked(cell_at(adr, 0)?)
            .first()
            .copied()
            .unwrap_or_default();
        let code = ticked(cell_at(adr, 1)?)
            .first()
            .copied()
            .unwrap_or_default();
        let data = cell_at(adr, 4)?;

        assert_eq!(role.role.as_str(), name);
        assert_eq!(role.default_code, code, "{name}");
        assert_eq!(role.status.to_string(), cell_at(adr, 2)?, "{name}");
        assert_eq!(role.nature.as_str(), cell_at(adr, 3)?, "{name}");

        if data == "none" {
            assert!(role.data.is_empty(), "{name}");

            continue;
        }

        let required = if data.contains("(required)") {
            DatumRequired::Always
        } else if data.contains("required on") || data.contains("required when") {
            DatumRequired::Conditional
        } else {
            DatumRequired::Never
        };
        let [datum] = role.data.as_slice() else {
            return Err(format!("{name}: one datum expected"));
        };

        assert_eq!(Some(datum.name), ticked(data).first().copied(), "{name}");
        assert_eq!(datum.required, required, "{name}");
    }

    Ok(())
}

#[test]
fn the_roles_are_the_irs_known_error_roles() -> Outcome {
    let entry = OPEN_ENUMS
        .iter()
        .find(|entry| entry.definition == "ErrorRole")
        .ok_or("no ErrorRole entry")?;
    let mut known: Vec<&str> = entry.known_values.to_vec();
    let mut roles: Vec<&str> = derivation_roles()
        .iter()
        .map(|entry| entry.role.as_str())
        .collect();

    known.sort_unstable();
    roles.sort_unstable();

    assert_eq!(roles, known);

    Ok(())
}

#[test]
fn a_conditional_datum_states_its_condition_and_only_it() {
    for role in derivation_roles() {
        for datum in &role.data {
            assert_eq!(
                datum.condition.is_some(),
                datum.required == DatumRequired::Conditional,
                "{}.{}",
                role.role,
                datum.name
            );
        }
    }
}

#[test]
fn an_issues_in_is_one_of_path_query_header_body_and_members_keep_the_adr_order() -> Outcome {
    let members = derivation_issue_members();
    let names: Vec<&str> = members.iter().map(|member| member.name).collect();
    let TypeUse::Scalar(location) = &members.first().ok_or("no member")?.type_use else {
        return Err("`in` is no scalar".to_owned());
    };
    let pattern = location.refinements.pattern.as_ref().ok_or("no pattern")?;

    assert_eq!(names, ["in", "pointer", "rule"]);
    assert_eq!(pattern.source, "^(?:path|query|header|body)$");
    assert_eq!(pattern.normalized, pattern.source);
    assert_eq!(
        IssueLocation::ALL.map(IssueLocation::as_str),
        ["path", "query", "header", "body"]
    );

    Ok(())
}

#[test]
fn the_payload_limit_type_use_is_a_count_and_the_delay_fits_a_retry_header() -> Outcome {
    let limit = derivation_role_of(&ErrorRole::PayloadTooLarge)
        .and_then(|role| role.data.first())
        .ok_or("no limit datum")?;
    let delay = derivation_role_of(&ErrorRole::RateLimited)
        .and_then(|role| role.data.first())
        .ok_or("no delay datum")?;
    let (TypeUse::Scalar(limit), TypeUse::Scalar(delay)) = (&limit.type_use, &delay.type_use)
    else {
        return Err("no scalar".to_owned());
    };

    assert_eq!(limit.r#type, ScalarType::Integer);
    assert_eq!(
        limit
            .refinements
            .minimum
            .as_ref()
            .map(seampact_ir::DecimalLiteral::as_str),
        Some("0")
    );
    assert!(limit.refinements.maximum.is_none());
    assert_eq!(
        delay
            .refinements
            .maximum
            .as_ref()
            .map(seampact_ir::DecimalLiteral::as_str),
        Some("9007199254740991")
    );
    assert_eq!(
        derivation_role_of(&ErrorRole::IdempotencyInProgress).map(|role| role.nature.clone()),
        Some(NatureBase::Unavailable)
    );

    Ok(())
}

#[test]
fn a_role_the_revision_does_not_know_has_no_entry() -> Outcome {
    let unknown: ErrorRole =
        serde_json::from_str("\"teapot\"").map_err(|failure| failure.to_string())?;

    assert!(derivation_role_of(&unknown).is_none());

    Ok(())
}

fn datum_of(role: &ErrorRole, name: &str) -> Result<&'static RoleDatum, String> {
    derivation_role_of(role)
        .and_then(|entry| entry.data.iter().find(|datum| datum.name == name))
        .ok_or_else(|| format!("no datum {name}"))
}

#[test]
fn the_rate_limit_delay_fills_the_param_the_convention_names() -> Outcome {
    let delay = datum_of(&ErrorRole::RateLimited, "retryAfterMs")?;
    let pointer = datum_of(&ErrorRole::Forbidden, "pointer")?;
    let limit = datum_of(&ErrorRole::PayloadTooLarge, "limitBytes")?;
    let issues = datum_of(&ErrorRole::SchemaInvalid, "issues")?;

    assert_eq!(
        derivation_param_of_datum(&ErrorRole::RateLimited, delay, Some("waitMs")),
        "waitMs"
    );
    assert_eq!(
        derivation_param_of_datum(&ErrorRole::RateLimited, delay, Some("")),
        ""
    );
    assert_eq!(
        derivation_param_of_datum(&ErrorRole::RateLimited, delay, None),
        "retryAfterMs"
    );
    assert_eq!(
        derivation_param_of_datum(&ErrorRole::Forbidden, pointer, Some("waitMs")),
        "pointer"
    );

    assert!(derivation_datum_always(
        &ErrorRole::RateLimited,
        delay,
        Some("waitMs")
    ));
    assert!(!derivation_datum_always(
        &ErrorRole::RateLimited,
        delay,
        None
    ));
    assert!(!derivation_datum_always(
        &ErrorRole::Forbidden,
        pointer,
        Some("waitMs")
    ));
    assert!(!derivation_datum_always(
        &ErrorRole::PayloadTooLarge,
        limit,
        None
    ));
    assert!(derivation_datum_always(
        &ErrorRole::SchemaInvalid,
        issues,
        None
    ));

    Ok(())
}

#[test]
fn the_params_schema_id_of_an_error_code_is_its_adr_0007_canonical_id() {
    for (code, id) in [
        ("api.rate_limited", "ApiRateLimitedParams"),
        ("tasks.locked", "TasksLockedParams"),
        ("1042", "_1042Params"),
        ("", "Params"),
    ] {
        assert_eq!(
            derivation_params_schema_id(code).unwrap().as_str(),
            id,
            "code {code:?}"
        );
    }
}
