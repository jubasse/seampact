//! The default classification table: each row a change kind, each case a cell per position.

use crate::diff_cell::{ADDITIVE, BOTH, CLIENTS, DiffCell, DiffFact, INFORMATIVE, SERVERS};
use crate::diff_kind::DiffKind;
use crate::diff_position::DiffPosition;

/// The cells of one case, in position order.
pub(crate) type CaseCells = &'static [(DiffPosition, DiffCell)];

/// The cases of one row, in table order.
pub(crate) type RowCases = &'static [(&'static str, CaseCells)];

/// `DIFF_TABLE`: every row of the classification table, in table order.
pub(crate) static DIFF_TABLE: &[(DiffKind, RowCases)] = &[
    (
        DiffKind::OperationAdded,
        &[("added", &[(DiffPosition::None, ADDITIVE)])],
    ),
    (
        DiffKind::OperationRemoved,
        &[("removed", &[(DiffPosition::None, CLIENTS)])],
    ),
    (
        DiffKind::OperationRoute,
        &[
            ("method", &[(DiffPosition::None, BOTH)]),
            ("path", &[(DiffPosition::None, BOTH)]),
            ("surface", &[(DiffPosition::None, BOTH)]),
            ("surfacePrefix", &[(DiffPosition::None, BOTH)]),
            ("pathVersion", &[(DiffPosition::None, BOTH)]),
            ("safe", &[(DiffPosition::None, BOTH)]),
        ],
    ),
    (
        DiffKind::OperationFormat,
        &[("changed", &[(DiffPosition::None, BOTH)])],
    ),
    (
        DiffKind::PropertyAdded,
        &[
            (
                "optional",
                &[
                    (DiffPosition::Input, ADDITIVE),
                    (DiffPosition::Output, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "required",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::PropertyRemoved,
        &[
            (
                "required",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "optional",
                &[
                    (
                        DiffPosition::Input,
                        DiffCell::Conditional {
                            when: DiffFact::AfterRefusesUnknownKeys,
                            holds: &CLIENTS,
                            otherwise: &ADDITIVE,
                        },
                    ),
                    (DiffPosition::Output, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::PropertyRequired,
        &[
            (
                "optionalToRequired",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "requiredToOptional",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Nullable,
        &[
            (
                "added",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "removed",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::TypeChanged,
        &[
            (
                "kind",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "scalarType",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "format",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "ref",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "enum",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "keys",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "content",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "body",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "variantSchema",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "int64Wire",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "outputEnums",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "urls",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "wire",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Refinement,
        &[
            (
                "tightened",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "loosened",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "changed",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::PatternChanged,
        &[(
            "changed",
            &[
                (DiffPosition::Input, BOTH),
                (DiffPosition::Output, BOTH),
                (DiffPosition::None, INFORMATIVE),
            ],
        )],
    ),
    (
        DiffKind::EnumValue,
        &[
            (
                "added",
                &[
                    (DiffPosition::Input, SERVERS),
                    (
                        DiffPosition::Output,
                        DiffCell::Conditional {
                            when: DiffFact::OutputEnumsOpenInBoth,
                            holds: &ADDITIVE,
                            otherwise: &CLIENTS,
                        },
                    ),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "removed",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::UnionVariant,
        &[
            (
                "added",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "removed",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::UnionTag,
        &[(
            "changed",
            &[
                (DiffPosition::Input, BOTH),
                (DiffPosition::Output, BOTH),
                (DiffPosition::None, INFORMATIVE),
            ],
        )],
    ),
    (
        DiffKind::DefaultChanged,
        &[
            (
                "added",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "changed",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "removed",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::ParamAdded,
        &[
            ("optional", &[(DiffPosition::Input, ADDITIVE)]),
            ("required", &[(DiffPosition::Input, CLIENTS)]),
        ],
    ),
    (
        DiffKind::ParamRemoved,
        &[
            ("required", &[(DiffPosition::Input, BOTH)]),
            (
                "optional",
                &[(
                    DiffPosition::Input,
                    DiffCell::Conditional {
                        when: DiffFact::AfterRefusesUnknownQuery,
                        holds: &CLIENTS,
                        otherwise: &ADDITIVE,
                    },
                )],
            ),
        ],
    ),
    (
        DiffKind::ParamRequired,
        &[
            ("optionalToRequired", &[(DiffPosition::Input, CLIENTS)]),
            ("requiredToOptional", &[(DiffPosition::Input, SERVERS)]),
        ],
    ),
    (
        DiffKind::UnknownQuery,
        &[
            ("refused", &[(DiffPosition::Input, CLIENTS)]),
            ("ignored", &[(DiffPosition::Input, ADDITIVE)]),
        ],
    ),
    (
        DiffKind::UnknownKeys,
        &[
            (
                "refused",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "ignored",
                &[
                    (DiffPosition::Input, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "kept",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Body,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, BOTH)]),
            ("mediaRemoved", &[(DiffPosition::Input, CLIENTS)]),
            ("rawBody", &[(DiffPosition::Input, SERVERS)]),
        ],
    ),
    (
        DiffKind::Proof,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Response,
        &[
            ("added", &[(DiffPosition::Output, CLIENTS)]),
            ("removed", &[(DiffPosition::Output, SERVERS)]),
            ("changed", &[(DiffPosition::Output, BOTH)]),
            ("mediaChanged", &[(DiffPosition::Output, BOTH)]),
            ("shape", &[(DiffPosition::Output, BOTH)]),
        ],
    ),
    (
        DiffKind::ResponseHeaderAdded,
        &[
            ("optional", &[(DiffPosition::Output, ADDITIVE)]),
            ("required", &[(DiffPosition::Output, SERVERS)]),
        ],
    ),
    (
        DiffKind::ResponseHeaderRemoved,
        &[
            ("required", &[(DiffPosition::Output, CLIENTS)]),
            ("optional", &[(DiffPosition::Output, ADDITIVE)]),
        ],
    ),
    (
        DiffKind::ResponseHeaderRequired,
        &[
            ("optionalToRequired", &[(DiffPosition::Output, SERVERS)]),
            ("requiredToOptional", &[(DiffPosition::Output, CLIENTS)]),
        ],
    ),
    (
        DiffKind::ResponseHeaderSemantic,
        &[("changed", &[(DiffPosition::Output, BOTH)])],
    ),
    (
        DiffKind::Access,
        &[
            ("tightened", &[(DiffPosition::Input, CLIENTS)]),
            ("loosened", &[(DiffPosition::Input, SERVERS)]),
            ("principalOptionalAdded", &[(DiffPosition::Input, ADDITIVE)]),
            (
                "principalOptionalRemoved",
                &[(DiffPosition::Input, SERVERS)],
            ),
            ("identity", &[(DiffPosition::Input, BOTH)]),
            ("schemeAdded", &[(DiffPosition::Input, ADDITIVE)]),
            ("schemeRemoved", &[(DiffPosition::Input, CLIENTS)]),
        ],
    ),
    (
        DiffKind::CallerKind,
        &[
            ("added", &[(DiffPosition::Input, SERVERS)]),
            ("removed", &[(DiffPosition::Input, CLIENTS)]),
        ],
    ),
    (
        DiffKind::PrincipalRequirement,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
        ],
    ),
    (
        DiffKind::Scope,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
            (
                "within",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Requirement,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Binding,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Csrf,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Owner,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Concurrency,
        &[
            ("added", &[(DiffPosition::Input, CLIENTS)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("changed", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::FieldRight,
        &[
            (
                "added",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "removed",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "changed",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::FilteredBy,
        &[
            ("added", &[(DiffPosition::Output, CLIENTS)]),
            ("removed", &[(DiffPosition::Output, SERVERS)]),
            ("changed", &[(DiffPosition::Output, BOTH)]),
        ],
    ),
    (
        DiffKind::Idempotency,
        &[
            ("addedRequired", &[(DiffPosition::Input, CLIENTS)]),
            ("addedOptional", &[(DiffPosition::Input, ADDITIVE)]),
            ("removed", &[(DiffPosition::Input, SERVERS)]),
            ("optionalToRequired", &[(DiffPosition::Input, CLIENTS)]),
            ("requiredToOptional", &[(DiffPosition::Input, SERVERS)]),
            ("header", &[(DiffPosition::Input, BOTH)]),
            ("replayHeader", &[(DiffPosition::Output, CLIENTS)]),
            ("lifetimeShortened", &[(DiffPosition::Input, SERVERS)]),
            ("lifetimeLengthened", &[(DiffPosition::Input, CLIENTS)]),
            (
                "lifetimeLengthenedUnenforced",
                &[(DiffPosition::Input, ADDITIVE)],
            ),
            ("enforceDropped", &[(DiffPosition::Input, SERVERS)]),
            ("enforceAdded", &[(DiffPosition::Input, CLIENTS)]),
        ],
    ),
    (
        DiffKind::Paging,
        &[
            ("added", &[(DiffPosition::Input, BOTH)]),
            ("removed", &[(DiffPosition::Input, BOTH)]),
            ("style", &[(DiffPosition::Input, BOTH)]),
            ("token", &[(DiffPosition::Input, BOTH)]),
            ("defaultLimit", &[(DiffPosition::Input, BOTH)]),
            ("overLimitRejected", &[(DiffPosition::Input, CLIENTS)]),
            ("overLimitClamped", &[(DiffPosition::Input, ADDITIVE)]),
            ("sortKeyAdded", &[(DiffPosition::Input, SERVERS)]),
            ("sortKeyRemoved", &[(DiffPosition::Input, CLIENTS)]),
            ("sortKeyChanged", &[(DiffPosition::Input, BOTH)]),
        ],
    ),
    (
        DiffKind::Error,
        &[
            ("added", &[(DiffPosition::Output, CLIENTS)]),
            ("removed", &[(DiffPosition::Output, SERVERS)]),
            ("roles", &[(DiffPosition::Output, BOTH)]),
            ("retryHeaderAdded", &[(DiffPosition::Output, ADDITIVE)]),
            ("retryHeaderRemoved", &[(DiffPosition::Output, CLIENTS)]),
            ("retryHeaderChanged", &[(DiffPosition::Output, BOTH)]),
            (
                "status",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "nature",
                &[
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "family",
                &[
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Declaration,
        &[
            ("added", &[(DiffPosition::None, INFORMATIVE)]),
            ("removed", &[(DiffPosition::None, INFORMATIVE)]),
        ],
    ),
    (
        DiffKind::Format,
        &[
            (
                "media",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "absent",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "success",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "meta",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "error",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::PagingStyle,
        &[
            (
                "position",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "absent",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "request",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "response",
                &[
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "handlerResult",
                &[
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Scheme,
        &[
            (
                "kind",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "name",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "csrf",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "signature",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Identity,
        &[
            (
                "kind",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "schemeAdded",
                &[
                    (DiffPosition::Input, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "schemeRemoved",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "schemeRoles",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "principal",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "unknownKeys",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "headerAddedRequired",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "headerAddedOptional",
                &[
                    (DiffPosition::Input, ADDITIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "headerRemoved",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "headerChanged",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Right,
        &[
            (
                "subject",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::Output, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "guestAdded",
                &[
                    (DiffPosition::Input, SERVERS),
                    (DiffPosition::Output, SERVERS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "guestRemoved",
                &[
                    (DiffPosition::Input, CLIENTS),
                    (DiffPosition::Output, CLIENTS),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Rule,
        &[
            (
                "takesBucket",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "proof",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Bucket,
        &[(
            "key",
            &[
                (DiffPosition::Input, BOTH),
                (DiffPosition::None, INFORMATIVE),
            ],
        )],
    ),
    (
        DiffKind::Header,
        &[
            (
                "semantic",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "name",
                &[
                    (DiffPosition::Input, BOTH),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
        ],
    ),
    (
        DiffKind::Maturity,
        &[
            ("lowered", &[(DiffPosition::None, CLIENTS)]),
            ("raised", &[(DiffPosition::None, INFORMATIVE)]),
        ],
    ),
    (
        DiffKind::Deprecation,
        &[
            ("added", &[(DiffPosition::None, INFORMATIVE)]),
            ("removed", &[(DiffPosition::None, INFORMATIVE)]),
            ("sinceChanged", &[(DiffPosition::None, INFORMATIVE)]),
            ("sunsetLater", &[(DiffPosition::None, INFORMATIVE)]),
            ("successorChanged", &[(DiffPosition::None, INFORMATIVE)]),
            ("sunsetEarlier", &[(DiffPosition::None, CLIENTS)]),
        ],
    ),
    (
        DiffKind::CompatPolicy,
        &[("changed", &[(DiffPosition::None, INFORMATIVE)])],
    ),
    (
        DiffKind::PackUpgraded,
        &[
            ("added", &[(DiffPosition::None, INFORMATIVE)]),
            ("removed", &[(DiffPosition::None, INFORMATIVE)]),
            ("version", &[(DiffPosition::None, INFORMATIVE)]),
        ],
    ),
    (
        DiffKind::Order,
        &[
            (
                "properties",
                &[
                    (DiffPosition::Input, INFORMATIVE),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "variants",
                &[
                    (DiffPosition::Input, INFORMATIVE),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            (
                "values",
                &[
                    (DiffPosition::Input, INFORMATIVE),
                    (DiffPosition::Output, INFORMATIVE),
                    (DiffPosition::None, INFORMATIVE),
                ],
            ),
            ("params", &[(DiffPosition::Input, INFORMATIVE)]),
            ("packs", &[(DiffPosition::None, INFORMATIVE)]),
            ("scopes", &[(DiffPosition::Input, INFORMATIVE)]),
            ("requires", &[(DiffPosition::Input, INFORMATIVE)]),
        ],
    ),
    (
        DiffKind::Name,
        &[(
            "any",
            &[
                (DiffPosition::Input, INFORMATIVE),
                (DiffPosition::Output, INFORMATIVE),
                (DiffPosition::None, INFORMATIVE),
            ],
        )],
    ),
    (
        DiffKind::Annotation,
        &[(
            "any",
            &[
                (DiffPosition::Input, INFORMATIVE),
                (DiffPosition::Output, INFORMATIVE),
                (DiffPosition::None, INFORMATIVE),
            ],
        )],
    ),
    (
        DiffKind::Unclassified,
        &[(
            "any",
            &[
                (DiffPosition::Input, BOTH),
                (DiffPosition::Output, BOTH),
                (DiffPosition::None, BOTH),
            ],
        )],
    ),
];
