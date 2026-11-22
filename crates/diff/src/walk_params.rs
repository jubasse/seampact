//! The comparison of the path, query and header parameters of two operations.

use seampact_diff_table::{DiffFact, DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{Operation, Param, Params};

use crate::DiffError;
use crate::change_sink::{ElementOrigin, RawChange};
use crate::walk_catalogue::emit_default_change;
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_kept_order, compare_members, emit_at,
};
use crate::walk_json::{flag_value, object_members, pointer_join, text_value};
use crate::walk_operations::operation_site;
use crate::walk_type_use::compare_type_use;

/// The policy of an operation that refuses undeclared query keys.
const UNKNOWN_QUERY_REFUSE: &str = "refuse";

/// Where a parameter travels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParamPlace {
    Path,
    Query,
    Header,
}

impl ParamPlace {
    const ALL: [Self; 3] = [Self::Path, Self::Query, Self::Header];

    const fn as_str(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::Query => "query",
            Self::Header => "header",
        }
    }

    fn params_of(self, params: &Params) -> &[Param] {
        match self {
            Self::Path => &params.path,
            Self::Query => &params.query,
            Self::Header => &params.header,
        }
    }
}

/// Compares the params of two operations place by place.
pub(crate) fn compare_params(
    context: &mut WalkContext<'_>,
    pointer: &str,
    before: &Operation,
    after: &Operation,
) -> Result<(), DiffError> {
    let operation_site = operation_site(after, DiffPosition::Input, &after.origin);
    let mut comparisons = MemberComparisons::new();

    for place in ParamPlace::ALL {
        comparisons.insert(
            place.as_str(),
            Box::new(
                move |context, member_pointer, _before_value, _after_value| {
                    let facts = if place == ParamPlace::Query
                        && after.unknown_query.tag() == UNKNOWN_QUERY_REFUSE
                    {
                        vec![DiffFact::AfterRefusesUnknownQuery]
                    } else {
                        Vec::new()
                    };

                    compare_param_list(
                        context,
                        after,
                        member_pointer,
                        place.params_of(&before.params),
                        place.params_of(&after.params),
                        &facts,
                    )
                },
            ),
        );
    }

    compare_members(
        context,
        &operation_site.site(),
        IrDefinition::Params,
        pointer,
        Some(&object_members(&before.params)?),
        Some(&object_members(&after.params)?),
        &comparisons,
    )
}

fn param_case(param: &Param) -> &'static str {
    if param.required {
        "required"
    } else {
        "optional"
    }
}

/// The site of one param's changes: the operation's input, with the param's own origin.
fn param_site<'site>(site: &ChangeSite<'site>, param: &Param) -> ChangeSite<'site> {
    ChangeSite {
        reaches: site.reaches,
        origin: param.origin.as_ref().map(ElementOrigin::from),
    }
}

/// Compares two lists of params by name: added, removed, changed, and the order they keep.
fn compare_param_list(
    context: &mut WalkContext<'_>,
    operation: &Operation,
    pointer: &str,
    before: &[Param],
    after: &[Param],
    removal_facts: &[DiffFact],
) -> Result<(), DiffError> {
    let operation_site = operation_site(operation, DiffPosition::Input, &operation.origin);
    let site = operation_site.site();

    for (index, param) in after.iter().enumerate() {
        if before.iter().any(|candidate| candidate.name == param.name) {
            continue;
        }

        emit_at(
            context,
            &param_site(&site, param),
            RawChange::new(
                DiffKind::ParamAdded,
                param_case(param),
                pointer_join(pointer, &[&index.to_string()]),
            )
            .between(None, Some(text_value(&param.name))),
        );
    }

    for (index, param) in before.iter().enumerate() {
        let Some((kept, after_param)) = after
            .iter()
            .enumerate()
            .find(|(_, candidate)| candidate.name == param.name)
        else {
            emit_at(
                context,
                &param_site(&site, param),
                RawChange::new(
                    DiffKind::ParamRemoved,
                    param_case(param),
                    pointer_join(pointer, &[&index.to_string()]),
                )
                .between(Some(text_value(&param.name)), None)
                .with_facts(removal_facts.to_vec()),
            );

            continue;
        };

        compare_kept_param(
            context,
            &param_site(&site, after_param),
            &pointer_join(pointer, &[&kept.to_string()]),
            param,
            after_param,
        )?;
    }

    let before_names: Vec<&str> = before.iter().map(|param| param.name.as_str()).collect();
    let after_names: Vec<&str> = after.iter().map(|param| param.name.as_str()).collect();

    compare_kept_order(
        context,
        &site,
        pointer,
        "params",
        &before_names,
        &after_names,
    );

    Ok(())
}

fn compare_kept_param(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Param,
    after: &Param,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "type",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_type_use(context, site, member_pointer, &before.r#type, &after.r#type)
        }),
    );
    comparisons.insert(
        "default",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_default_change(
                context,
                site,
                member_pointer,
                before.default.as_ref(),
                after.default.as_ref(),
            );

            Ok(())
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
                    DiffKind::ParamRequired,
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
        IrDefinition::Param,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}
