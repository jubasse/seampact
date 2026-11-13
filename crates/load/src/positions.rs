//! Where the authoring schemas expect which type (ADR 0002 section 3, P6), and where they expect
//! any value (a data position, marked `DATA` by the grammar: a payload, an example, a default).
//!
//! The loader reads the schemas of [`seampact_authoring::AUTHORING_SCHEMA_FILES`] as plain JSON,
//! without validating anything (the validate stage owns that). [`Positions`] is a deliberate,
//! bounded interpreter: it models the keywords in [`POSITION_KEYWORDS`] and ignores, by name, the
//! value constraints in [`IGNORED_KEYWORDS`], which never change where a key leads nor which type
//! a scalar has there. A test fails on any other keyword the authoring schemas start to use.
//!
//! A position is one schema node, reached from the file's root schema one key or index at a time.
//! A step keeps the shape of the combinators: the node's own `properties`, `patternProperties`,
//! `additionalProperties` or `items`, its `$ref` and its `allOf` members all hold together
//! (their results join as an `allOf`); the members of an `anyOf` or a `oneOf`, and the `then`
//! and `else` branches, are alternatives (an `anyOf`). An alternative that does not constrain
//! the child at all makes the whole alternative unknown, so a key is never typed by one branch
//! while another branch would take any value there. An alternative that cannot hold the child (a
//! string form, when a key is read; a key its `additionalProperties: false` refuses or a conflict
//! marker forbids) is dropped; in constraints that hold together, it makes the child impossible
//! (the validate stage reports it).
//!
//! A branch chosen by the keys of the mapping being read (`if` with `required` or a `const`
//! property: a node with `method` is a route) is chosen with [`Positions::refine_position`]; an
//! `if` on the type of the value holding the key (a mapping, or a list) is chosen when stepping.
//! A condition that cannot be decided keeps every branch.
//!
//! The reading is conservative on purpose: a type is expected only when every route to the
//! position states one. Anything the walk cannot decide (an unknown key, a node that states no
//! type) is left to the validate stage, so a correctly typed scalar is never refused here.

mod condition;
mod keywords;
mod leaves;
mod position;
mod scalar_type;
mod schema_files;
mod schema_node;
mod step;
mod types;

pub use condition::{MapView, ScalarRead};
pub use keywords::{IGNORED_KEYWORDS, POSITION_KEYWORDS};
pub use position::{Position, Positions, expected_types, refuses_scalar};
pub use scalar_type::{ScalarType, scalar_type};
pub use step::StepKind;
pub use types::{TypeName, TypeSet};

#[cfg(test)]
mod tests;
