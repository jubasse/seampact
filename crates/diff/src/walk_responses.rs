//! The comparison of the responses of two operations: status, media, body and headers.

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{Operation, Response, ResponseHeader};
use seampact_json::{JsonNumber, JsonValue};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::walk_context::{
    ChangeSite, KeyedListComparison, MemberComparisons, WalkContext, compare_keyed_list,
    compare_members, emit_at,
};
use crate::walk_json::{flag_value, object_members, pointer_join, text_value};
use crate::walk_operations::operation_site_with_origin;
use crate::walk_type_use::compare_type_use;

fn status_value(response: &Response) -> JsonValue {
    JsonValue::Number(JsonNumber::from_i64(response.status))
}

/// A response with the position it has in its list.
type IndexedResponse<'list> = (usize, &'list Response);

fn lacking_status<'list>(
    responses: &'list [Response],
    other: &[Response],
) -> Vec<IndexedResponse<'list>> {
    responses
        .iter()
        .enumerate()
        .filter(|(_, response)| {
            !other
                .iter()
                .any(|candidate| candidate.status == response.status)
        })
        .collect()
}

fn emit_response(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    response_case: &str,
    pointer: String,
    before: Option<JsonValue>,
    after: Option<JsonValue>,
) {
    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Response, response_case, pointer).between(before, after),
    );
}

/// Compares the responses of two operations by status: added, removed, a status replaced, and
/// the content of the statuses both keep.
pub(crate) fn compare_responses(
    context: &mut WalkContext<'_>,
    pointer: &str,
    operation: &Operation,
    before: &[Response],
    after: &[Response],
) -> Result<(), DiffError> {
    let removed = lacking_status(before, after);
    let added = lacking_status(after, before);

    // One success status replaced by another: the same response under a new status.
    if let ([(_, removed_only)], [(added_index, added_only)]) =
        (removed.as_slice(), added.as_slice())
    {
        let response_pointer = pointer_join(pointer, &[&added_index.to_string()]);
        let changed_operation_site =
            operation_site_with_origin(operation, DiffPosition::Output, added_only.origin.as_ref());

        emit_response(
            context,
            &changed_operation_site.site(),
            "changed",
            response_pointer.clone(),
            Some(status_value(removed_only)),
            Some(status_value(added_only)),
        );
        compare_response(
            context,
            operation,
            &response_pointer,
            removed_only,
            added_only,
        )?;
    } else {
        for (index, response) in &added {
            let response_site = operation_site_with_origin(
                operation,
                DiffPosition::Output,
                response.origin.as_ref(),
            );

            emit_response(
                context,
                &response_site.site(),
                "added",
                pointer_join(pointer, &[&index.to_string()]),
                None,
                Some(status_value(response)),
            );
        }

        for (index, response) in &removed {
            let response_site = operation_site_with_origin(
                operation,
                DiffPosition::Output,
                response.origin.as_ref(),
            );

            emit_response(
                context,
                &response_site.site(),
                "removed",
                pointer_join(pointer, &[&index.to_string()]),
                Some(status_value(response)),
                None,
            );
        }
    }

    for (index, response) in after.iter().enumerate() {
        let Some(before_response) = before
            .iter()
            .find(|candidate| candidate.status == response.status)
        else {
            continue;
        };

        compare_response(
            context,
            operation,
            &pointer_join(pointer, &[&index.to_string()]),
            before_response,
            response,
        )?;
    }

    Ok(())
}

/// Compares two responses of one status: media, body and headers.
fn compare_response(
    context: &mut WalkContext<'_>,
    operation: &Operation,
    pointer: &str,
    before: &Response,
    after: &Response,
) -> Result<(), DiffError> {
    let operation_site =
        operation_site_with_origin(operation, DiffPosition::Output, after.origin.as_ref());
    let site = operation_site.site();
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "status",
        Box::new(|_context, _member_pointer, _before_value, _after_value| Ok(())),
    );
    comparisons.insert(
        "media",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_response(
                context,
                &site,
                "mediaChanged",
                member_pointer.to_owned(),
                before_value.cloned(),
                after_value.cloned(),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "body",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let (Some(before_body), Some(after_body)) = (&before.body, &after.body) else {
                emit_at(
                    context,
                    &site,
                    RawChange::new(DiffKind::TypeChanged, "body", member_pointer.to_owned()),
                );

                return Ok(());
            };

            compare_type_use(context, &site, member_pointer, before_body, after_body)
        }),
    );
    comparisons.insert(
        "headers",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_response_headers(
                context,
                &site,
                member_pointer,
                &before.headers,
                &after.headers,
            )
        }),
    );

    compare_members(
        context,
        &site,
        IrDefinition::Response,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

fn required_case(header: &ResponseHeader) -> &'static str {
    if header.required {
        "required"
    } else {
        "optional"
    }
}

/// Compares the headers of two responses by case-folded name.
fn compare_response_headers(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[ResponseHeader],
    after: &[ResponseHeader],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|header: &ResponseHeader| Ok(header.name.to_lowercase())),
        added: Box::new(|context, entry_pointer, header| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::ResponseHeaderAdded,
                    required_case(header),
                    entry_pointer.to_owned(),
                )
                .between(None, Some(text_value(&header.name))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, header| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::ResponseHeaderRemoved,
                    required_case(header),
                    entry_pointer.to_owned(),
                )
                .between(Some(text_value(&header.name)), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_header, after_header| {
            compare_kept_header(context, site, entry_pointer, before_header, after_header)
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

fn compare_kept_header(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &ResponseHeader,
    after: &ResponseHeader,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "name",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Annotation, "name", member_pointer.to_owned()).between(
                    Some(text_value(&before.name)),
                    Some(text_value(&after.name)),
                ),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "type",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_type_use(context, site, member_pointer, &before.r#type, &after.r#type)
        }),
    );
    comparisons.insert(
        "required",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let required_case = if after.required {
                "optionalToRequired"
            } else {
                "requiredToOptional"
            };

            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::ResponseHeaderRequired,
                    required_case,
                    member_pointer.to_owned(),
                )
                .between(
                    Some(flag_value(before.required)),
                    Some(flag_value(after.required)),
                ),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::ResponseHeader,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::change_sink::{ChangeSink, NO_POSITION};
    use crate::sample_ir::sample_ir;
    use crate::walk_reach::ReachIndex;

    fn header(name: &str, required: bool) -> ResponseHeader {
        let text = format!(
            r#"{{"name":"{name}","type":{{"kind":"scalar","type":"string","refinements":[]}},"required":{required}}}"#
        );

        serde_json::from_str(&text).unwrap_or_else(|error| panic!("{text}: {error}"))
    }

    #[test]
    fn headers_match_by_lowercase_name_including_the_final_sigma() {
        let ir = sample_ir();
        let mut context = WalkContext {
            before: &ir,
            after: &ir,
            before_reach: ReachIndex::new(),
            after_reach: ReachIndex::new(),
            sink: ChangeSink::new(HashSet::new()),
        };
        let site = ChangeSite {
            reaches: &NO_POSITION,
            origin: None,
        };

        compare_response_headers(
            &mut context,
            &site,
            "/h",
            &[header("X-Id", true), header("\u{391}\u{3a3}", true)],
            &[header("x-id", true), header("\u{3b1}\u{3c2}", false)],
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let cases: Vec<String> = context
            .sink
            .sorted_changes()
            .into_iter()
            .map(|change| change.case_name)
            .collect();

        // Both pairs are kept (a rename and a required change), none is added or removed.
        assert_eq!(
            cases,
            vec![
                "name".to_owned(),
                "name".to_owned(),
                "responseHeader.required.requiredToOptional".to_owned()
            ]
        );
    }
}
