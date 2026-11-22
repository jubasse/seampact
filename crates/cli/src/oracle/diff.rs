//! The diff cases: the codes and table, and the diff of two compiled fixtures.

use indexmap::IndexMap;
use seampact_compiler::{PipelineOptions, compile_workspace};
use seampact_diff::{DiffError, diff_contract_sets, diff_contracts, format_diff_report};
use seampact_diff_table::{
    DeprecationEntry, DiffChange, DiffComparison, DiffExemption, DiffOptions, DiffRefusal,
    DiffResult, DiffValue, GateFailure, diff_table_json,
};
use seampact_ir::{ApiVersion, CompatPolicy, ContractIr, PackRef};
use seampact_json::{JsonValue, canonical_document};
use seampact_load::{FsReader, LoadOptions};
use seampact_oracle::{DiffAnswer, DiffCase, DiffSide, Fixture, SubjectAnswer};
use serde::{Serialize, Serializer};

use crate::diff_command::diff_options;

/// The diff codes and table, `{ "codes", "table" }`.
pub(crate) fn diff_table_answer() -> SubjectAnswer<JsonValue> {
    SubjectAnswer::Ported(diff_table_json())
}

/// Compiles both sides of `case` and diffs them.
pub(crate) fn diff_answer(case: &DiffCase) -> SubjectAnswer<DiffAnswer> {
    let sides = match (side_irs(&case.before), side_irs(&case.after)) {
        (Ok(before), Ok(after)) => (before, after),
        (Err(message), _) | (_, Err(message)) => {
            return SubjectAnswer::InternalError { message };
        }
    };
    let options = match case_options(&case.options) {
        Ok(options) => options,
        Err(message) => return SubjectAnswer::InternalError { message },
    };

    match diff_both_sides(&sides.0, &sides.1, &options) {
        Ok(answer) => SubjectAnswer::Ported(answer),
        Err(DiffCaseError::Diff(error)) => SubjectAnswer::InternalError {
            message: error.to_string(),
        },
        Err(DiffCaseError::Setup(message)) => SubjectAnswer::InternalError { message },
    }
}

enum DiffCaseError {
    Diff(DiffError),
    Setup(String),
}

impl From<DiffError> for DiffCaseError {
    fn from(error: DiffError) -> Self {
        Self::Diff(error)
    }
}

/// `diffContracts` when each side holds one api, else `diffContractSets` with one report per api.
fn diff_both_sides(
    before: &IndexMap<String, ContractIr>,
    after: &IndexMap<String, ContractIr>,
    options: &DiffOptions,
) -> Result<DiffAnswer, DiffCaseError> {
    if let (Some((_, only_before)), Some((_, only_after)), 1, 1) =
        (before.first(), after.first(), before.len(), after.len())
    {
        let result = diff_contracts(only_before, only_after, options)?;

        return Ok(DiffAnswer {
            result: result_json(&result)?,
            report: format_diff_report(&result)?,
        });
    }

    let results = diff_contract_sets(before, after, options)?;
    let mut reports = Vec::new();
    let mut members = serde_json::Map::new();

    for (api, result) in &results {
        reports.push(format!("== {api} ==\n{}", format_diff_report(result)?));
        members.insert(api.clone(), result_value(result)?);
    }

    let result = JsonValue::try_from(serde_json::Value::Object(members))
        .map_err(|error| DiffCaseError::Setup(error.to_string()))?;

    Ok(DiffAnswer {
        result,
        report: reports.join("\n"),
    })
}

/// The IR of each api a side compiles to, by api id.
fn side_irs(side: &DiffSide) -> Result<IndexMap<String, ContractIr>, String> {
    match side {
        DiffSide::Ir(value) => {
            let ir = ContractIr::from_json_text(&canonical_document(value))
                .map_err(|error| error.to_string())?;

            Ok(IndexMap::from([(ir.api.id.clone(), ir)]))
        }
        DiffSide::Fixture(fixture) => fixture_irs(fixture),
    }
}

fn fixture_irs(fixture: &Fixture) -> Result<IndexMap<String, ContractIr>, String> {
    let reader = FsReader::new(&fixture.directory).map_err(|error| error.to_string())?;
    let no_imports = IndexMap::new();
    let options = PipelineOptions {
        load: LoadOptions {
            reader: &reader,
            entry: &fixture.entry,
        },
        imports: &no_imports,
    };
    let result = compile_workspace(&options).map_err(|error| error.to_string())?;
    let mut irs = IndexMap::new();

    for compiled in result.apis {
        let Some(ir) = compiled.ir else {
            return Err(format!("the api '{}' has no IR to diff", compiled.api));
        };

        irs.insert(compiled.api, ir);
    }

    Ok(irs)
}

/// The options of `diff.options.json`: `today`, and optionally `gate` and `exempt`, read by the
/// reader of the `diff` command.
fn case_options(raw: &JsonValue) -> Result<DiffOptions, String> {
    let JsonValue::Object(members) = raw else {
        return Err("the diff options are not a JSON object".to_owned());
    };
    let Some(JsonValue::String(today)) = members.get("today") else {
        return Err("the diff options have no `today` text".to_owned());
    };

    diff_options(today.clone(), Some(raw)).map_err(|error| error.to_string())
}

fn result_json(result: &DiffResult) -> Result<JsonValue, DiffCaseError> {
    JsonValue::try_from(result_value(result)?)
        .map_err(|error| DiffCaseError::Setup(error.to_string()))
}

fn result_value(result: &DiffResult) -> Result<serde_json::Value, DiffCaseError> {
    serde_json::to_value(ResultForm(result))
        .map_err(|error| DiffCaseError::Setup(error.to_string()))
}

/// `DiffResult` as `JSON.stringify` writes the TypeScript's.
struct ResultForm<'result>(&'result DiffResult);

impl Serialize for ResultForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            DiffResult::Refused(refusals) => RefusedForm {
                ok: false,
                refusals: refusals.iter().map(RefusalForm).collect(),
            }
            .serialize(serializer),
            DiffResult::Compared(comparison) => ComparedForm(comparison).serialize(serializer),
        }
    }
}

#[derive(Serialize)]
struct RefusedForm<'result> {
    ok: bool,
    refusals: Vec<RefusalForm<'result>>,
}

struct RefusalForm<'result>(&'result DiffRefusal);

impl Serialize for RefusalForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Form<'form> {
            code: &'static str,
            message: &'form str,
            fix: &'form str,
            #[serde(skip_serializing_if = "Option::is_none")]
            before: Option<ValueForm<'form>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            after: Option<ValueForm<'form>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            member: Option<&'form str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            operations: Option<&'form [String]>,
        }

        let refusal = self.0;

        Form {
            code: refusal.code.as_str(),
            message: &refusal.message,
            fix: &refusal.fix,
            before: refusal.before.as_ref().map(ValueForm),
            after: refusal.after.as_ref().map(ValueForm),
            member: refusal.member.as_deref(),
            operations: refusal.operations.as_deref(),
        }
        .serialize(serializer)
    }
}

struct ValueForm<'value>(&'value DiffValue);

impl Serialize for ValueForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            DiffValue::Text(text) => serializer.serialize_str(text),
            DiffValue::Number(number) => JsonValue::Number(number.clone()).serialize(serializer),
            DiffValue::Bool(flag) => serializer.serialize_bool(*flag),
            DiffValue::Null => serializer.serialize_none(),
        }
    }
}

struct ComparedForm<'result>(&'result DiffComparison);

impl Serialize for ComparedForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Form<'form> {
            ok: bool,
            api: &'form str,
            before: SideForm<'form>,
            after: SideForm<'form>,
            policy: PolicyForm<'form>,
            settings: SettingsForm,
            changes: Vec<ChangeForm<'form>>,
            gate: GateForm<'form>,
            deprecations: Vec<DeprecationForm<'form>>,
        }

        let comparison = self.0;

        Form {
            ok: true,
            api: &comparison.api,
            before: SideForm::of(
                &comparison.before.version,
                comparison.before.ir_revision,
                &comparison.before.packs,
            ),
            after: SideForm::of(
                &comparison.after.version,
                comparison.after.ir_revision,
                &comparison.after.packs,
            ),
            policy: PolicyForm {
                before: &comparison.policy.before,
                after: &comparison.policy.after,
                applied: &comparison.policy.applied,
            },
            settings: SettingsForm {
                gate: comparison.settings.gate.as_str(),
                exempt: comparison
                    .settings
                    .exempt
                    .iter()
                    .map(|exemption| exemption.as_str())
                    .collect(),
            },
            changes: comparison.changes.iter().map(ChangeForm).collect(),
            gate: GateForm {
                passed: comparison.gate.passed,
                failures: comparison.gate.failures.iter().map(FailureForm).collect(),
            },
            deprecations: comparison
                .deprecations
                .iter()
                .map(DeprecationForm)
                .collect(),
        }
        .serialize(serializer)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SideForm<'side> {
    version: &'side ApiVersion,
    ir_revision: i64,
    packs: &'side [PackRef],
}

impl<'side> SideForm<'side> {
    fn of(version: &'side ApiVersion, ir_revision: i64, packs: &'side [PackRef]) -> Self {
        Self {
            version,
            ir_revision,
            packs,
        }
    }
}

#[derive(Serialize)]
struct PolicyForm<'policy> {
    before: &'policy CompatPolicy,
    after: &'policy CompatPolicy,
    applied: &'policy CompatPolicy,
}

#[derive(Serialize)]
struct SettingsForm {
    gate: &'static str,
    exempt: Vec<&'static str>,
}

#[derive(Serialize)]
struct GateForm<'gate> {
    passed: bool,
    failures: Vec<FailureForm<'gate>>,
}

struct ChangeForm<'change>(&'change DiffChange);

impl Serialize for ChangeForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct CauseForm<'form> {
            pack: &'form str,
        }

        #[derive(Serialize)]
        struct Form<'form> {
            kind: &'static str,
            case: &'form str,
            pointer: &'form str,
            position: &'static str,
            operations: &'form [String],
            breaks: Vec<&'static str>,
            classification: &'static str,
            #[serde(skip_serializing_if = "Option::is_none")]
            before: Option<ValueForm<'form>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            after: Option<ValueForm<'form>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            cause: Option<CauseForm<'form>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            exemption: Option<&'static str>,
        }

        let change = self.0;

        Form {
            kind: change.kind.as_str(),
            case: &change.case_name,
            pointer: &change.pointer,
            position: change.position.as_str(),
            operations: &change.operations,
            breaks: change.breaks.iter().map(|side| side.as_str()).collect(),
            classification: change.classification.as_str(),
            before: change.before.as_ref().map(ValueForm),
            after: change.after.as_ref().map(ValueForm),
            cause: change
                .cause
                .as_ref()
                .map(|cause| CauseForm { pack: &cause.pack }),
            exemption: change.exemption.map(DiffExemption::as_str),
        }
        .serialize(serializer)
    }
}

struct FailureForm<'failure>(&'failure GateFailure);

impl Serialize for FailureForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct MaturityForm<'form> {
            #[serde(skip_serializing_if = "Option::is_none")]
            operation: Option<&'form str>,
            level: &'form str,
            source: &'form str,
        }

        #[derive(Serialize)]
        struct Form<'form> {
            kind: &'static str,
            case: &'form str,
            pointer: &'form str,
            position: &'static str,
            breaks: Vec<&'static str>,
            operations: &'form [String],
            code: &'static str,
            message: &'form str,
            fix: &'form str,
            #[serde(skip_serializing_if = "Option::is_none")]
            maturity: Option<MaturityForm<'form>>,
        }

        let failure = self.0;

        Form {
            code: failure.code.as_str(),
            message: &failure.message,
            fix: &failure.fix,
            kind: failure.kind.as_str(),
            case: &failure.case_name,
            pointer: &failure.pointer,
            position: failure.position.as_str(),
            breaks: failure.breaks.iter().map(|side| side.as_str()).collect(),
            operations: &failure.operations,
            maturity: failure.maturity.as_ref().map(|maturity| MaturityForm {
                operation: maturity.operation.as_deref(),
                level: &maturity.level,
                source: maturity.source.as_str(),
            }),
        }
        .serialize(serializer)
    }
}

struct DeprecationForm<'entry>(&'entry DeprecationEntry);

impl Serialize for DeprecationForm<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct OperationForm<'form> {
            subject: &'static str,
            operation: &'form str,
            pointer: &'form str,
            status: &'static str,
            since: &'form str,
            sunset: &'form str,
            #[serde(skip_serializing_if = "Option::is_none")]
            successor: Option<&'form str>,
            days_to_sunset: i64,
            past_sunset: bool,
        }

        #[derive(Serialize)]
        struct MemberForm<'form> {
            subject: &'static str,
            pointer: &'form str,
            schema: &'form str,
            #[serde(skip_serializing_if = "Option::is_none")]
            property: Option<&'form str>,
            status: &'static str,
        }

        match self.0 {
            DeprecationEntry::Operation {
                operation,
                pointer,
                status,
                since,
                sunset,
                successor,
                days_to_sunset,
                past_sunset,
            } => OperationForm {
                subject: "operation",
                operation,
                pointer,
                status: status.as_str(),
                since,
                sunset,
                successor: successor.as_deref(),
                days_to_sunset: *days_to_sunset,
                past_sunset: *past_sunset,
            }
            .serialize(serializer),
            DeprecationEntry::Schema {
                pointer,
                schema,
                status,
            } => MemberForm {
                subject: "schema",
                pointer,
                schema,
                property: None,
                status: status.as_str(),
            }
            .serialize(serializer),
            DeprecationEntry::Property {
                pointer,
                schema,
                property,
                status,
            } => MemberForm {
                subject: "property",
                pointer,
                schema,
                property: Some(property),
                status: status.as_str(),
            }
            .serialize(serializer),
        }
    }
}
