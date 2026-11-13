//! A scalar of the tree, and the P6 check of its type against the authoring schema.

use seampact_diagnostics::{InternalError, diagnostic_inert, mapping_keys_hint};
use seampact_json::{JsonValue, write_json_string};

use super::{Expander, Scope};
use crate::budget::utf16_length;
use crate::positions::{
    Position, ScalarType, TypeName, expected_types, refuses_scalar, scalar_type,
};
use crate::report::LoadRule;
use crate::scalars::ResolvedScalar;
use crate::source::{ParsedFile, node_span};
use crate::yaml::YamlNode;

/// The plain spellings of null that a data position refuses: it must be written `null`.
const NULL_SPELLINGS: [&str; 4] = ["", "~", "Null", "NULL"];

/// 2^53 - 1: the largest whole number a JavaScript number holds exactly.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

impl Expander<'_, '_> {
    pub(super) fn scalar(
        &mut self,
        node: &YamlNode,
        source: &str,
        scope: &Scope,
    ) -> Result<JsonValue, InternalError> {
        let Some(resolved) = node.resolved_scalar() else {
            return Err(InternalError::new("a scalar node resolves to no value"));
        };

        if !scope.data && node.tag.is_none() {
            self.check_type(node, source, &resolved, scope)?;
        }

        if scope.data
            && node.is_plain_scalar()
            && node.tag.is_none()
            && NULL_SPELLINGS.contains(&source)
        {
            self.report(
                LoadRule::DataNull,
                format!(
                    "null is written '{source}' here; in a data position it must be written null"
                ),
                "write null",
                node_span(&scope.file, Some(node)),
            )?;
        }

        let value = resolved.into_json_value();

        if let JsonValue::String(text) = &value
            && !self.charge_text(utf16_length(text), || node_span(&scope.file, Some(node)))?
        {
            return Ok(JsonValue::Null);
        }

        Ok(value)
    }

    /// P6 (ADR 0002 section 3): a scalar whose YAML type is not one the authoring schema accepts
    /// at this position, null included. The tag case is P9's, reported by the file walk.
    fn check_type(
        &mut self,
        node: &YamlNode,
        source: &str,
        resolved: &ResolvedScalar,
        scope: &Scope,
    ) -> Result<(), InternalError> {
        let Some(scalar) = scalar_type_of(resolved) else {
            return Ok(());
        };
        let Some(position) = &scope.pos else {
            return Ok(());
        };

        if !refuses_scalar(Some(position), scalar) {
            return self.check_quoted_integer(node, source, &scope.file, position);
        }

        // A plain scalar P1 to P4 refuse is reported once, by them: their fix (quote it) is the one.
        if node.is_plain_scalar()
            && self
                .store
                .patterns()
                .load_scalar_pitfall(source, resolved)
                .is_some()
        {
            return Ok(());
        }

        let expected = expected_types(position).unwrap_or_default();
        let written = if node.is_plain_scalar() {
            source.to_owned()
        } else {
            json_text_of(source)
        };
        let shown = diagnostic_inert(&crate::source::shown_source(&written));
        let wants = expected.join(" or ");
        let got = match scalar {
            ScalarType::Null => "a null (no value, '~' or null)".to_owned(),
            ScalarType::Integer => format!("'{shown}' is an integer"),
            other => format!("'{shown}' is a {}", scalar_type_name(other)),
        };
        let quotable = expected.contains(&"a string") && scalar != ScalarType::Null;
        let keys_hint = if expected.contains(&"a mapping") {
            mapping_keys_hint(&self.positions.expected_keys(position))
        } else {
            String::new()
        };
        let fix = if quotable {
            format!("quote it ('{shown}') to write a string")
        } else {
            format!("write {wants}{keys_hint}")
        };

        self.report(
            LoadRule::ScalarType,
            format!("{got} where the schema expects {wants} (P6)"),
            &fix,
            node_span(&scope.file, Some(node)),
        )
    }

    /// P6, the ADR's own `version: '1'`: where a string or an integer goes, a quoted whole number
    /// in plain decimal that the integer form takes is the integer, written as a string by mistake.
    fn check_quoted_integer(
        &mut self,
        node: &YamlNode,
        source: &str,
        file: &ParsedFile,
        position: &Position,
    ) -> Result<(), InternalError> {
        if node.is_plain_scalar() {
            return Ok(());
        }

        let takes_both = position.types().is_some_and(|types| {
            types.contains(&TypeName::String) && types.contains(&TypeName::Integer)
        });

        if !takes_both {
            return Ok(());
        }

        let Some(whole_number) = safe_whole_number(source) else {
            return Ok(());
        };

        if !self.positions.admits_integer(position, whole_number) {
            return Ok(());
        }

        let wants = expected_types(position).unwrap_or_default().join(" or ");

        self.report(
            LoadRule::ScalarType,
            format!(
                "'{}' is a quoted whole number where the schema expects {wants}, and reads as the integer (P6)",
                json_text_of(source)
            ),
            &format!("write {source}, unquoted"),
            node_span(file, Some(node)),
        )
    }
}

/// The type of a resolved scalar; a number with no finite value is a number, as in JavaScript.
fn scalar_type_of(resolved: &ResolvedScalar) -> Option<ScalarType> {
    match resolved {
        ResolvedScalar::NonFinite => Some(ScalarType::Number),
        other => scalar_type(&other.clone().into_json_value()),
    }
}

fn scalar_type_name(scalar: ScalarType) -> &'static str {
    match scalar {
        ScalarType::String => "string",
        ScalarType::Number => "number",
        ScalarType::Integer => "integer",
        ScalarType::Boolean => "boolean",
        ScalarType::Null => "null",
    }
}

/// `JSON.stringify` of a string.
fn json_text_of(text: &str) -> String {
    let mut written = String::new();

    write_json_string(&mut written, text);

    written
}

/// The value of text that is a whole number in plain decimal (`-?(0|[1-9][0-9]*)`) within the
/// safe integer range, else `None`.
fn safe_whole_number(text: &str) -> Option<f64> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    let has_only_digits = !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit());
    let has_leading_zero = digits.len() > 1 && digits.starts_with('0');

    if !has_only_digits || has_leading_zero {
        return None;
    }

    let number: f64 = text.parse().ok()?;

    (number.abs() <= MAX_SAFE_INTEGER).then_some(number)
}
