//! The six halves of the three passes of ADR 0006, in run order.

use std::fmt;

/// The pass a half belongs to (ADR 0006 section 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PassName {
    /// The `tree` pass.
    Tree,
    /// The `access` pass.
    Access,
    /// The `derive` pass.
    Derive,
}

impl PassName {
    /// The pass name as ADR 0006 writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tree => "tree",
            Self::Access => "access",
            Self::Derive => "derive",
        }
    }
}

impl fmt::Display for PassName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One half of a pass. Each half is a step of the stop rule: a half that reports an error
/// completes, and no later half of that api runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Half {
    /// `tree.schemas`.
    TreeSchemas,
    /// `tree.nodes`.
    TreeNodes,
    /// `access.identity`.
    AccessIdentity,
    /// `access.rights`.
    AccessRights,
    /// `derive.wire`.
    DeriveWire,
    /// `derive.errors`.
    DeriveErrors,
}

impl Half {
    /// The halves in run order: each runs after every half it reads.
    pub const RUN_ORDER: [Self; 6] = [
        Self::TreeSchemas,
        Self::TreeNodes,
        Self::AccessIdentity,
        Self::AccessRights,
        Self::DeriveWire,
        Self::DeriveErrors,
    ];

    /// The pass this half belongs to.
    #[must_use]
    pub const fn pass(self) -> PassName {
        match self {
            Self::TreeSchemas | Self::TreeNodes => PassName::Tree,
            Self::AccessIdentity | Self::AccessRights => PassName::Access,
            Self::DeriveWire | Self::DeriveErrors => PassName::Derive,
        }
    }

    /// The dotted name of the half, as the expected delta files and the ADR write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TreeSchemas => "tree.schemas",
            Self::TreeNodes => "tree.nodes",
            Self::AccessIdentity => "access.identity",
            Self::AccessRights => "access.rights",
            Self::DeriveWire => "derive.wire",
            Self::DeriveErrors => "derive.errors",
        }
    }

    /// The half with this dotted name, if there is one.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::RUN_ORDER
            .into_iter()
            .find(|half| half.as_str() == name)
    }

    /// The position of the half in [`Half::RUN_ORDER`].
    #[must_use]
    pub const fn run_position(self) -> usize {
        self as usize
    }
}

/// A half that runs after `tree.schemas` and reads the schema service it built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LaterHalf {
    /// `tree.nodes`.
    TreeNodes,
    /// `access.identity`.
    AccessIdentity,
    /// `access.rights`.
    AccessRights,
    /// `derive.wire`.
    DeriveWire,
    /// `derive.errors`.
    DeriveErrors,
}

impl LaterHalf {
    /// The later halves in [`Half::RUN_ORDER`] order.
    pub const RUN_ORDER: [Self; 5] = [
        Self::TreeNodes,
        Self::AccessIdentity,
        Self::AccessRights,
        Self::DeriveWire,
        Self::DeriveErrors,
    ];

    /// The later half `half` is, or `None` for `tree.schemas`.
    #[must_use]
    pub const fn of(half: Half) -> Option<Self> {
        match half {
            Half::TreeSchemas => None,
            Half::TreeNodes => Some(Self::TreeNodes),
            Half::AccessIdentity => Some(Self::AccessIdentity),
            Half::AccessRights => Some(Self::AccessRights),
            Half::DeriveWire => Some(Self::DeriveWire),
            Half::DeriveErrors => Some(Self::DeriveErrors),
        }
    }
}

impl From<LaterHalf> for Half {
    fn from(half: LaterHalf) -> Self {
        match half {
            LaterHalf::TreeNodes => Self::TreeNodes,
            LaterHalf::AccessIdentity => Self::AccessIdentity,
            LaterHalf::AccessRights => Self::AccessRights,
            LaterHalf::DeriveWire => Self::DeriveWire,
            LaterHalf::DeriveErrors => Self::DeriveErrors,
        }
    }
}

impl fmt::Display for LaterHalf {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(Half::from(*self).as_str())
    }
}

impl fmt::Display for Half {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_order_lists_each_half_once_in_declaration_order() {
        let positions: Vec<usize> = Half::RUN_ORDER
            .iter()
            .map(|half| half.run_position())
            .collect();

        assert_eq!(positions, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn every_half_names_its_pass_and_round_trips_its_name() {
        for half in Half::RUN_ORDER {
            let (pass, _) = half.as_str().split_once('.').expect("a dotted name");

            assert_eq!(half.pass().as_str(), pass, "{half}");
            assert_eq!(Half::from_name(half.as_str()), Some(half));
        }
    }

    #[test]
    fn the_later_halves_are_the_run_order_after_tree_schemas() {
        let later: Vec<Half> = LaterHalf::RUN_ORDER.into_iter().map(Half::from).collect();
        let back: Vec<Option<LaterHalf>> = Half::RUN_ORDER.into_iter().map(LaterHalf::of).collect();

        assert_eq!(later, Half::RUN_ORDER.get(1..).unwrap());
        assert_eq!(back.first(), Some(&None));
        assert!(
            LaterHalf::RUN_ORDER
                .into_iter()
                .all(|half| LaterHalf::of(half.into()) == Some(half))
        );
    }

    #[test]
    fn a_name_that_is_no_half_is_refused() {
        for name in [
            "",
            "tree",
            "tree.",
            "Tree.nodes",
            "tree.nodes ",
            "derive.wires",
        ] {
            assert_eq!(Half::from_name(name), None, "{name:?}");
        }
    }
}
