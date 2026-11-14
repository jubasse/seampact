//! A schema service answering what a test sets: `tree.schemas` stands behind every later half.

use indexmap::IndexMap;
use seampact_ir::{Direction, QueryWire, TypeUse};
use seampact_json::JsonValue;

use crate::{PassError, TreeSchemaExampleIssue, TreeSchemaService};

/// A schema service answering the listed pointers only.
///
/// An unlisted pointer answers no type use and no query wire, so a test of a new service call
/// proves the pointer it asks. Example checks answer the issues set, the same for every value.
#[derive(Debug, Clone, Default)]
pub struct FakeSchemaService {
    type_uses: IndexMap<String, TypeUse>,
    query_wires: IndexMap<String, QueryWire>,
    example_issues: Vec<TreeSchemaExampleIssue>,
    text_example_issues: Vec<TreeSchemaExampleIssue>,
}

impl FakeSchemaService {
    /// A service answering nothing: no type use, no query wire, no example issue.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Answers `type_use` for the schema written at `pointer`, in either direction.
    #[must_use]
    pub fn with_type_use(mut self, pointer: &str, type_use: TypeUse) -> Self {
        self.type_uses.insert(pointer.to_owned(), type_use);

        self
    }

    /// Answers `query_wire` for the field at `pointer`.
    #[must_use]
    pub fn with_query_wire(mut self, pointer: &str, query_wire: QueryWire) -> Self {
        self.query_wires.insert(pointer.to_owned(), query_wire);

        self
    }

    /// Answers `issues` to every example value checked.
    #[must_use]
    pub fn with_example_issues(mut self, issues: Vec<TreeSchemaExampleIssue>) -> Self {
        self.example_issues = issues;

        self
    }

    /// Answers `issues` to every example text checked.
    #[must_use]
    pub fn with_text_example_issues(mut self, issues: Vec<TreeSchemaExampleIssue>) -> Self {
        self.text_example_issues = issues;

        self
    }
}

impl TreeSchemaService for FakeSchemaService {
    fn type_use(&self, pointer: &str, _direction: Direction) -> Result<Option<TypeUse>, PassError> {
        Ok(self.type_uses.get(pointer).cloned())
    }

    fn query_wire(&self, pointer: &str) -> Result<Option<QueryWire>, PassError> {
        Ok(self.query_wires.get(pointer).cloned())
    }

    fn check_example(
        &self,
        _value: &JsonValue,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(self.example_issues.clone())
    }

    fn check_text_example(
        &self,
        _text: &str,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(self.text_example_issues.clone())
    }
}
