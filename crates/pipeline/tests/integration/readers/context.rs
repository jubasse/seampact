//! `HalfContext`: the origin, the relayed drafts, the imports and the sink.

use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, InternalError, RuleId, Severity,
};
use seampact_pipeline::DraftIr;
use seampact_pipeline::testing::{HalfFixture, api_layer_origin};

#[test]
fn a_half_reads_origins_relayed_drafts_and_imports_and_reports_to_the_sink()
-> Result<(), InternalError> {
    let mut fixture = HalfFixture::from_json(r#"{"surfaces":{"app":{"identity":"user"}}}"#)?
        .with_relayed("b", DraftIr::new());

    fixture.with_context(|context| {
        assert_eq!(
            context.origin("/surfaces/app/identity"),
            Some(api_layer_origin("/surfaces/app/identity"))
        );
        assert_eq!(context.origin("/nothing"), None);
        assert!(context.relayed("c").is_none());
        assert!(context.imported("b").is_none());

        // A relayed draft borrows the run, so it is still held across a report.
        let relayed_draft = context.relayed("b");

        context.report(Diagnostic {
            severity: Severity::Error,
            rule: RuleId::new("tree-example".to_owned()),
            message: "m".to_owned(),
            fix: "f".to_owned(),
            origin: DiagnosticOrigin {
                layer: DiagnosticLayer::Api,
                pointer: String::new(),
                api: None,
            },
            related: Vec::new(),
        });

        assert!(relayed_draft.is_some());
    })?;

    assert_eq!(fixture.into_diagnostics().len(), 1);

    Ok(())
}
