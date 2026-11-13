//! What the loader does with the parts of the load its expander borrows: report, charge, switch
//! the layer, name a file.

use seampact_authoring::FileLayer;
use seampact_diagnostics::InternalError;
use seampact_span::Span;

use super::Loader;
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite};

impl Loader<'_, '_> {
    pub(super) fn report(
        &mut self,
        rule: LoadRule,
        message: String,
        fix: &str,
        at: Span,
    ) -> Result<(), InternalError> {
        self.report_related(rule, message, fix, at, Vec::new())
    }

    pub(super) fn report_related(
        &mut self,
        rule: LoadRule,
        message: String,
        fix: &str,
        at: Span,
        related: Vec<RelatedSite>,
    ) -> Result<(), InternalError> {
        let parts = self.expander.parts();
        let pending =
            PendingDiagnostic::new(rule, message, fix.to_owned(), at).with_related(related);

        parts.reporter.report(parts.store.files(), pending)
    }

    /// Charges `units` to the load's budget; `false` once it is spent.
    pub(super) fn charge(&mut self, units: u64, at: Span) -> Result<bool, InternalError> {
        let parts = self.expander.parts();

        parts
            .budget
            .charge(units, || at, parts.reporter, parts.store.files())
    }

    pub(super) fn budget_exhausted(&mut self) -> bool {
        self.expander.parts().budget.exhausted()
    }

    pub(super) fn set_layer(&mut self, layer: FileLayer) {
        self.expander.parts().reporter.layer = layer;
    }

    pub(super) fn current_layer(&mut self) -> FileLayer {
        self.expander.parts().reporter.layer.clone()
    }

    /// How many diagnostics are reported: the `since` of a later relabel.
    pub(super) fn reported_count(&mut self) -> usize {
        self.expander.parts().reporter.len()
    }

    pub(super) fn relabel(&mut self, since: usize, from: &FileLayer, to: &FileLayer) {
        self.expander.parts().reporter.relabel(since, from, to);
    }

    /// The path of the file a span is in: `at.file` of the TypeScript site.
    pub(super) fn file_path_of(&mut self, at: Span) -> Result<String, InternalError> {
        self.expander
            .parts()
            .store
            .files()
            .get(at.file)
            .map(|file| file.path().to_owned())
            .ok_or_else(|| {
                InternalError::new(format!(
                    "a site is in file {}, which is not held",
                    at.file.index()
                ))
            })
    }
}
