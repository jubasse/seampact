//! Which operations reach each named schema, enum, scalar and declaration, and from which position:
//! input is the request, output the success responses, their headers, the errors and the wire format.

use std::collections::{BTreeMap, HashSet};

use indexmap::IndexMap;
use seampact_diff_table::{DiffFact, DiffPosition};
use seampact_ir::{
    ContractIr, Direction, IdentityHeaderUse, KnownAccessRef, KnownIdentityRef, KnownPrincipalRef,
    KnownRequirementRef, KnownRightSubjectRef, KnownSchemaRef, KnownSchemeRef, KnownTypeUseRef,
    Operation, Principal, SchemaRef, SchemeId, TypeUse, UnknownKeysPolicy,
};

use crate::DiffError;
use crate::change_sink::{ChangeReach, NO_POSITION};

/// The position an operation reaches a member from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ReachPosition {
    Input,
    Output,
}

impl ReachPosition {
    fn as_str(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
        }
    }

    fn diff_position(self) -> DiffPosition {
        match self {
            Self::Input => DiffPosition::Input,
            Self::Output => DiffPosition::Output,
        }
    }
}

/// One operation reaching a member from one position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReachEntry {
    pub(crate) operation: String,
    pub(crate) position: ReachPosition,
    /// The input use reaching the member refuses unknown keys (the default of an input use).
    pub(crate) refuses_unknown_keys: bool,
}

/// Entries by reach key (`schemas/<id>`, `enums/<id>`, `scalars/<id>`, `<declaration catalogue>/<id>`,
/// `wire/int64`, `wire/outputEnums`), then by place.
pub(crate) type ReachIndex = IndexMap<String, IndexMap<String, ReachEntry>>;

/// The reach key of the int64 wire form.
pub(crate) const INT64_REACH_KEY: &str = "wire/int64";

/// The reach key of the output enum wire form.
pub(crate) const OUTPUT_ENUMS_REACH_KEY: &str = "wire/outputEnums";

/// The `format` of a scalar use that reaches the int64 wire form.
const INT64_FORMAT: &str = "int64";

pub(crate) fn schema_reach_key(id: &str) -> String {
    format!("schemas/{id}")
}

pub(crate) fn enum_reach_key(id: &str) -> String {
    format!("enums/{id}")
}

pub(crate) fn scalar_reach_key(id: &str) -> String {
    format!("scalars/{id}")
}

/// The reach key of an entry of a declaration catalogue (`errors`, `identities`, `formats`...).
pub(crate) fn declaration_reach_key(catalogue: &str, id: &str) -> String {
    format!("{catalogue}/{id}")
}

/// The reaches of every operation of `ir`.
///
/// # Errors
///
/// [`DiffError::Internal`] for a bug.
pub(crate) fn build_reach_index(ir: &ContractIr) -> Result<ReachIndex, DiffError> {
    let mut index = ReachIndex::new();

    for operation in &ir.operations {
        visit_operation(ir, operation, &mut index)?;
    }

    Ok(index)
}

fn place_of(entry: &ReachEntry) -> String {
    format!("{}\0{}", entry.operation, entry.position.as_str())
}

fn visit_operation(
    ir: &ContractIr,
    operation: &Operation,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    let input = ReachEntry {
        operation: operation.id.as_str().to_owned(),
        position: ReachPosition::Input,
        refuses_unknown_keys: true,
    };
    let output = ReachEntry {
        operation: operation.id.as_str().to_owned(),
        position: ReachPosition::Output,
        refuses_unknown_keys: false,
    };
    let params = operation
        .params
        .path
        .iter()
        .chain(&operation.params.query)
        .chain(&operation.params.header);

    for param in params {
        visit_type_use(ir, &param.r#type, &input, index)?;
    }

    if let Some(body) = &operation.input {
        visit_type_use(ir, &body.schema, &input, index)?;

        for proof in body.proofs.iter().flatten() {
            visit_type_use(ir, &proof.schema, &input, index)?;
        }
    }

    for response in &operation.responses {
        if let Some(body) = &response.body {
            visit_type_use(ir, body, &output, index)?;
        }

        for header in &response.headers {
            visit_type_use(ir, &header.r#type, &output, index)?;
        }
    }

    for error in &operation.errors {
        let declaration = ir.errors.get(error.code.as_str());

        add_reach(
            index,
            &declaration_reach_key("errors", error.code.as_str()),
            &output,
        );

        if let Some(nature) = declaration.and_then(|found| found.nature_name.as_ref()) {
            add_reach(
                index,
                &declaration_reach_key("natures", nature.as_str()),
                &output,
            );
        }

        if let Some(params) = declaration.and_then(|found| found.params.as_ref()) {
            visit_schema(ir, params.as_str(), &output, index)?;
        }
    }

    visit_operation_declarations(ir, operation, &input, &output, index)
}

fn visit_operation_declarations(
    ir: &ContractIr,
    operation: &Operation,
    input: &ReachEntry,
    output: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    add_reach(
        index,
        &declaration_reach_key("formats", operation.format.as_str()),
        output,
    );

    if let Some(style) = operation
        .paging
        .as_ref()
        .and_then(|paging| paging.style.as_ref())
    {
        add_reach(
            index,
            &declaration_reach_key("pagings", style.as_str()),
            input,
        );
        add_reach(
            index,
            &declaration_reach_key("pagings", style.as_str()),
            output,
        );
    }

    match KnownAccessRef::try_from(&operation.access) {
        Ok(KnownAccessRef::Identity(access)) => {
            visit_identity(ir, access.identity.as_str(), input, index)?;

            for scheme in &access.schemes {
                visit_scheme(ir, scheme.as_str(), input, index)?;
            }
        }
        Ok(KnownAccessRef::Optional(access)) => {
            visit_identity(ir, access.identity.as_str(), input, index)?;

            for scheme in &access.schemes {
                visit_scheme(ir, scheme.as_str(), input, index)?;
            }
        }
        Ok(KnownAccessRef::Public(_)) | Err(_) => {}
    }

    for requirement in &operation.requires {
        let Ok(known) = KnownRequirementRef::try_from(requirement) else {
            continue;
        };

        match known {
            KnownRequirementRef::Right(right) => {
                visit_right(ir, right.right.as_str(), input, index)?;
            }
            KnownRequirementRef::Rule(rule) => {
                visit_rule(ir, rule.rule.as_str(), input, index)?;

                if let Some(bucket) = &rule.bucket {
                    add_reach(
                        index,
                        &declaration_reach_key("buckets", bucket.as_str()),
                        input,
                    );
                }
            }
        }
    }

    for field_right in &operation.field_rights {
        let entry = if field_right.direction == Direction::Output {
            output
        } else {
            input
        };

        visit_right(ir, field_right.right.as_str(), entry, index)?;
    }

    let sort_keys = operation.paging.iter().flat_map(|paging| &paging.sort_keys);

    for right in sort_keys.filter_map(|sort_key| sort_key.right.as_ref()) {
        visit_right(ir, right.as_str(), input, index)?;
    }

    if let Some(right) = &operation.filtered_by {
        visit_right(ir, right.as_str(), output, index)?;
    }

    for scope in &operation.scopes {
        visit_scope(ir, scope.scope.as_str(), input, index)?;
    }

    Ok(())
}

fn visit_type_use(
    ir: &ContractIr,
    type_use: &TypeUse,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    let Ok(known) = KnownTypeUseRef::try_from(type_use) else {
        return Ok(());
    };

    match known {
        KnownTypeUseRef::Ref(reference) => {
            let refuses = match reference.unknown_keys.as_ref().map(|keys| &keys.policy) {
                None => entry.refuses_unknown_keys,
                Some(policy) => *policy == UnknownKeysPolicy::Refuse,
            };
            let reached = ReachEntry {
                refuses_unknown_keys: entry.position == ReachPosition::Input && refuses,
                ..entry.clone()
            };

            visit_schema(ir, reference.schema.as_str(), &reached, index)
        }
        KnownTypeUseRef::Enum(enumeration) => {
            if enumeration.narrowed_to.is_none() {
                add_reach(index, &enum_reach_key(enumeration.r#enum.as_str()), entry);
            }

            if entry.position == ReachPosition::Output {
                add_reach(index, OUTPUT_ENUMS_REACH_KEY, entry);
            }

            Ok(())
        }
        KnownTypeUseRef::Scalar(scalar) => {
            if let Some(id) = &scalar.scalar {
                add_reach(index, &scalar_reach_key(id.as_str()), entry);
            }

            if scalar.format.as_deref() == Some(INT64_FORMAT) {
                add_reach(index, INT64_REACH_KEY, entry);
            }

            match &scalar.content {
                Some(content) => visit_type_use(ir, &content.schema, entry, index),
                None => Ok(()),
            }
        }
        KnownTypeUseRef::Array(array) => visit_type_use(ir, &array.items, entry, index),
        KnownTypeUseRef::File(_) | KnownTypeUseRef::Opaque(_) => Ok(()),
    }
}

fn visit_schema(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &schema_reach_key(id), entry) {
        return Ok(());
    }

    let Some(schema) = ir.schemas.get(id) else {
        return Ok(());
    };
    let Ok(known) = KnownSchemaRef::try_from(schema) else {
        return Ok(());
    };

    match known {
        KnownSchemaRef::Object(object) => {
            for property in &object.properties {
                visit_type_use(ir, &property.r#type, entry, index)?;
            }

            Ok(())
        }
        KnownSchemaRef::Map(map) => {
            if let Some(keys) = &map.keys {
                visit_type_use(ir, keys, entry, index)?;
            }

            visit_type_use(ir, &map.values, entry, index)
        }
        KnownSchemaRef::Union(union) => {
            for variant in &union.variants {
                visit_schema(ir, variant.schema.as_str(), entry, index)?;
            }

            Ok(())
        }
    }
}

/// Records `entry` under `key`; `false` when the key already held it.
fn add_reach(index: &mut ReachIndex, key: &str, entry: &ReachEntry) -> bool {
    let entries = index.entry(key.to_owned()).or_default();
    let entry_key = format!("{}\0{}", place_of(entry), entry.refuses_unknown_keys);

    if entries.contains_key(&entry_key) {
        return false;
    }

    entries.insert(entry_key, entry.clone());

    true
}

/// The reaches of an identity and what it names.
fn visit_identity(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &declaration_reach_key("identities", id), entry) {
        return Ok(());
    }

    let Some(identity) = ir.identities.get(id) else {
        return Ok(());
    };
    let Ok(known) = KnownIdentityRef::try_from(identity) else {
        return Ok(());
    };
    let (schemes, principal, headers): (Vec<&SchemeId>, &Principal, &[IdentityHeaderUse]) =
        match known {
            KnownIdentityRef::Signed(signed) => {
                (vec![&signed.signed], &signed.principal, &signed.headers)
            }
            KnownIdentityRef::Credential(credential) => (
                credential
                    .schemes
                    .read
                    .iter()
                    .chain(&credential.schemes.write)
                    .chain(&credential.schemes.optional_read)
                    .collect(),
                &credential.principal,
                &credential.headers,
            ),
        };

    for scheme in schemes {
        visit_scheme(ir, scheme.as_str(), entry, index)?;
    }

    if let Ok(known_principal) = KnownPrincipalRef::try_from(principal) {
        let principal_schemas: Vec<&SchemaRef> = match known_principal {
            KnownPrincipalRef::Schema(schema) => vec![&schema.schema],
            KnownPrincipalRef::Variants(variants) => variants.variants.values().collect(),
        };

        for schema in principal_schemas {
            visit_schema(ir, schema.as_str(), entry, index)?;
        }
    }

    for header in headers {
        let declaration = ir.headers.get(header.header.as_str());

        add_reach(
            index,
            &declaration_reach_key("headers", header.header.as_str()),
            entry,
        );

        if let Some(schema) = &header.schema {
            visit_type_use(ir, schema, entry, index)?;
        }

        if let Some(schema) = declaration.and_then(|found| found.schema.as_ref()) {
            visit_type_use(ir, schema, entry, index)?;
        }
    }

    Ok(())
}

/// The reaches of a scheme and what it names: a cookie scheme reaches its csrf scheme.
fn visit_scheme(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &declaration_reach_key("schemes", id), entry) {
        return Ok(());
    }

    let Some(scheme) = ir.schemes.get(id) else {
        return Ok(());
    };

    match KnownSchemeRef::try_from(scheme) {
        Ok(KnownSchemeRef::Cookie(cookie)) => match &cookie.csrf {
            Some(csrf) => visit_scheme(ir, csrf.as_str(), entry, index),
            None => Ok(()),
        },
        Ok(_) | Err(_) => Ok(()),
    }
}

/// The reaches of a right and what it names.
fn visit_right(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &declaration_reach_key("rights", id), entry) {
        return Ok(());
    }

    let Some(right) = ir.rights.get(id) else {
        return Ok(());
    };

    if let Some(params) = &right.params {
        visit_schema(ir, params.as_str(), entry, index)?;
    }

    match KnownRightSubjectRef::try_from(&right.subject) {
        Ok(KnownRightSubjectRef::Resource(resource)) => {
            visit_type_use(ir, &resource.id_schema, entry, index)
        }
        Ok(KnownRightSubjectRef::Scope(scope)) => {
            visit_scope(ir, scope.scope.as_str(), entry, index)
        }
        Ok(KnownRightSubjectRef::NoSubject(_)) | Err(_) => Ok(()),
    }
}

/// The reaches of a rule and what it names.
fn visit_rule(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &declaration_reach_key("rules", id), entry) {
        return Ok(());
    }

    let Some(rule) = ir.rules.get(id) else {
        return Ok(());
    };

    if let Some(params) = &rule.params {
        visit_schema(ir, params.as_str(), entry, index)?;
    }

    match &rule.proof {
        Some(proof) => visit_type_use(ir, &proof.schema, entry, index),
        None => Ok(()),
    }
}

/// The reaches of a scope and what it names: its id schema, then the scope it sits within.
fn visit_scope(
    ir: &ContractIr,
    id: &str,
    entry: &ReachEntry,
    index: &mut ReachIndex,
) -> Result<(), DiffError> {
    if !add_reach(index, &declaration_reach_key("scopes", id), entry) {
        return Ok(());
    }

    let Some(scope) = ir.scopes.get(id) else {
        return Ok(());
    };

    visit_type_use(ir, &scope.id_schema, entry, index)?;

    match &scope.within {
        Some(within) => visit_scope(ir, within.as_str(), entry, index),
        None => Ok(()),
    }
}

/// The entries of the reach key `key` in both indexes that sit at a place `before` also reaches,
/// grouped by position and unknown-keys policy and ordered by group key.
pub(crate) fn common_reaches(
    before: &ReachIndex,
    after: &ReachIndex,
    key: &str,
) -> Vec<ChangeReach> {
    let before_entries = before.get(key);
    let after_entries = after.get(key);

    if before_entries.is_none() && after_entries.is_none() {
        return NO_POSITION.to_vec();
    }

    let before_places: HashSet<String> = before_entries
        .into_iter()
        .flat_map(IndexMap::values)
        .map(place_of)
        .collect();
    let mut groups: BTreeMap<String, ReachGroup> = BTreeMap::new();

    for entry in after_entries.into_iter().flat_map(IndexMap::values) {
        if !before_places.contains(&place_of(entry)) {
            continue;
        }

        let group_key = format!("{}/{}", entry.position.as_str(), entry.refuses_unknown_keys);
        let group = groups.entry(group_key).or_insert_with(|| ReachGroup {
            position: entry.position,
            refuses: entry.refuses_unknown_keys,
            operations: Vec::new(),
        });

        group.operations.push(entry.operation.clone());
    }

    groups
        .into_values()
        .map(|group| ChangeReach {
            position: group.position.diff_position(),
            operations: group.operations,
            facts: if group.refuses {
                vec![DiffFact::AfterRefusesUnknownKeys]
            } else {
                Vec::new()
            },
        })
        .collect()
}

/// The operations reaching one member the same way.
struct ReachGroup {
    position: ReachPosition,
    refuses: bool,
    operations: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_of(key: &str, entries: &[(&str, ReachPosition, bool)]) -> ReachIndex {
        let mut index = ReachIndex::new();

        for (operation, position, refuses) in entries {
            add_reach(
                &mut index,
                key,
                &ReachEntry {
                    operation: (*operation).to_owned(),
                    position: *position,
                    refuses_unknown_keys: *refuses,
                },
            );
        }

        index
    }

    #[test]
    fn a_member_no_operation_reaches_has_the_one_reach_at_no_position() {
        let reaches = common_reaches(&ReachIndex::new(), &ReachIndex::new(), "schemas/Task");

        assert_eq!(reaches, NO_POSITION.to_vec());
    }

    #[test]
    fn common_reaches_keep_the_places_both_sides_reach_grouped_by_position_and_policy() {
        let before = index_of(
            "schemas/Task",
            &[
                ("getTask", ReachPosition::Output, false),
                ("createTask", ReachPosition::Input, true),
                ("listTasks", ReachPosition::Output, false),
            ],
        );
        let after = index_of(
            "schemas/Task",
            &[
                ("listTasks", ReachPosition::Output, false),
                ("createTask", ReachPosition::Input, true),
                ("updateTask", ReachPosition::Input, true),
                ("getTask", ReachPosition::Output, false),
            ],
        );
        let reaches = common_reaches(&before, &after, "schemas/Task");

        assert_eq!(
            reaches,
            vec![
                ChangeReach {
                    position: DiffPosition::Input,
                    operations: vec!["createTask".to_owned()],
                    facts: vec![DiffFact::AfterRefusesUnknownKeys],
                },
                ChangeReach {
                    position: DiffPosition::Output,
                    operations: vec!["listTasks".to_owned(), "getTask".to_owned()],
                    facts: Vec::new(),
                },
            ]
        );
    }

    #[test]
    fn a_member_only_one_side_reaches_has_no_common_reach() {
        let after = index_of("enums/Status", &[("getTask", ReachPosition::Output, false)]);

        assert_eq!(
            common_reaches(&ReachIndex::new(), &after, "enums/Status"),
            Vec::new()
        );
    }
}
