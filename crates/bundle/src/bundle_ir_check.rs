//! The third step of the bundle check, for one api: its IR file is readable JSON, declares the
//! version the manifest lists, is of a version this reader reads, and is valid.

use seampact_diagnostics::quote_text;
use seampact_ir::{
    ContractIr, IR_REVISION, IR_VERSION, IrSupport, IrSupportCode, IrSupportValue, check_ir_support,
};
use seampact_json::{JsonNumber, JsonValue, js_text_of, stringify_json};

use crate::not_ported::not_ported_yet;
use crate::untrusted_json::{UntrustedJson, parse_untrusted_json, utf8_text};
use crate::{BundleApi, BundleError, BundleFailure, BundleFailureCode};

const FIX: &str = "Rebuild the bundle with a compiler of this IR revision, or use the seampact release that reads it.";

/// This reader's version and exact revision; kinds and features are left to the target that
/// reads the IR.
const READER_SUPPORT: IrSupport<'static> = IrSupport {
    ir_versions: &[IR_VERSION],
    ir_revision: IR_REVISION,
    kinds: &[],
    features: &[],
};

/// The IR of one api, or the failure naming its file.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum BundleIrRead {
    /// The document passed every check.
    #[expect(
        dead_code,
        reason = "built once the open IR validator exists; until then the check answers not ported yet"
    )]
    Ir(Box<ContractIr>),
    /// Why the document is refused.
    Refused(BundleFailure),
}

/// Checks the IR file `bytes` of `api`.
pub(crate) fn check_bundle_ir(api: &BundleApi, bytes: &[u8]) -> Result<BundleIrRead, BundleError> {
    let parsed = match utf8_text(bytes) {
        None => UntrustedJson::Refused {
            problem: "is not UTF-8 text".to_owned(),
        },
        Some(text) => parse_untrusted_json(&text),
    };
    let document = match parsed {
        UntrustedJson::Parsed(document) => document,
        UntrustedJson::Refused { problem } => {
            return Ok(BundleIrRead::Refused(
                BundleFailure::new(
                    BundleFailureCode::IrUnreadable,
                    format!("'{}' {problem}.", api.file),
                    FIX,
                )
                .about(&api.file),
            ));
        }
    };

    if let Some(failure) = declaration_failure(api, &document) {
        return Ok(BundleIrRead::Refused(failure));
    }

    if let Some(failure) = support_failure(api, &document) {
        return Ok(BundleIrRead::Refused(failure));
    }

    valid_ir(api, &document)
}

fn declaration_failure(api: &BundleApi, document: &JsonValue) -> Option<BundleFailure> {
    let (ir_version, ir_revision) = match document {
        JsonValue::Object(object) => (object.get("irVersion"), object.get("irRevision")),
        _ => (None, None),
    };

    if is_integer(ir_version, api.ir_version) && is_integer(ir_revision, api.ir_revision) {
        return None;
    }

    Some(
        BundleFailure::new(
            BundleFailureCode::IrDeclaration,
            format!(
                "'{}' declares irVersion {} and irRevision {}; the manifest lists {} and {}.",
                api.file,
                quote_text(&declared_text(ir_version)),
                quote_text(&declared_text(ir_revision)),
                api.ir_version,
                api.ir_revision
            ),
            FIX,
        )
        .about(&api.file)
        .expecting(format!("{}.{}", api.ir_version, api.ir_revision))
        .finding(format!(
            "{}.{}",
            js_text_of(ir_version),
            js_text_of(ir_revision)
        )),
    )
}

/// `===` of a declared member against an integer of the manifest, which is within 2^53.
fn is_integer(declared: Option<&JsonValue>, expected: i64) -> bool {
    matches!(declared, Some(JsonValue::Number(number))
        if (number.to_f64() - JsonNumber::from_i64(expected).to_f64()).abs() < f64::EPSILON)
}

/// `quote`'s text of a value: a string as it is, any other value as `JSON.stringify` writes it.
fn declared_text(declared: Option<&JsonValue>) -> String {
    match declared {
        Some(JsonValue::String(text)) => text.clone(),
        Some(other) => stringify_json(other),
        None => "undefined".to_owned(),
    }
}

fn support_failure(api: &BundleApi, document: &JsonValue) -> Option<BundleFailure> {
    for mismatch in check_ir_support(document, &READER_SUPPORT) {
        let code = match mismatch.code {
            IrSupportCode::VersionUnsupported => BundleFailureCode::IrVersion,
            IrSupportCode::RevisionMismatch => BundleFailureCode::IrRevision,
            IrSupportCode::SupportMalformed => BundleFailureCode::IrInvalid,
            IrSupportCode::KindUnsupported | IrSupportCode::FeatureUnsupported => continue,
        };
        let expected: Vec<String> = mismatch.expected.iter().map(support_text).collect();
        let expected = expected.join(", ");

        return Some(
            BundleFailure::new(
                code,
                format!(
                    "'{}' holds {} at {}; this reader reads {expected}.",
                    api.file,
                    quote_text(&support_text(&mismatch.value)),
                    quote_text(&mismatch.member),
                ),
                FIX,
            )
            .about(&api.file)
            .expecting(expected)
            .finding(support_text(&mismatch.value)),
        );
    }

    None
}

fn support_text(value: &IrSupportValue) -> String {
    match value {
        IrSupportValue::Text(text) => text.clone(),
        IrSupportValue::Number(number) => number.to_string(),
    }
}

/// The document under the open IR JSON Schema, then as a typed IR.
fn valid_ir(_api: &BundleApi, _document: &JsonValue) -> Result<BundleIrRead, BundleError> {
    Err(not_ported_yet("createIrValidator"))
}
