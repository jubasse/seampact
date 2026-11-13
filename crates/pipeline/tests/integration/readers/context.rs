//! `HalfContext`: the origin, the relayed drafts, the imports and the sink.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_authoring::RawWorkspace;
use seampact_diagnostics::{
    Diagnostic, DiagnosticLayer, DiagnosticOrigin, DiagnosticSink, RuleId, Severity,
};
use seampact_pipeline::{DraftIr, HalfContext, Inherited, pipeline_conventions};

use super::raw_api::{api_origin, single_layer_api};

#[test]
fn a_half_reads_origins_relayed_drafts_and_imports_and_reports_to_the_sink() {
    let raw = single_layer_api(r#"{"surfaces":{"app":{"identity":"user"}}}"#);
    let workspace = RawWorkspace {
        root: Utf8PathBuf::from("."),
        apis: vec![raw.clone()],
        locations: IndexMap::new(),
        entry: None,
        config: None,
    };
    let conventions = pipeline_conventions(&raw);
    let inherited = Inherited::new(&raw).unwrap();
    let relayed: IndexMap<String, DraftIr> = IndexMap::from([("b".to_owned(), DraftIr::new())]);
    let imports = IndexMap::new();
    let mut sink = DiagnosticSink::new();
    let mut context = HalfContext::new(
        &raw,
        &workspace,
        &conventions,
        &inherited,
        &relayed,
        &imports,
        &mut sink,
    );

    assert_eq!(
        context.origin("/surfaces/app/identity"),
        Some(api_origin("/surfaces/app/identity"))
    );
    assert_eq!(context.origin("/nothing"), None);
    assert!(context.relayed("b").is_some());
    assert!(context.relayed("c").is_none());
    assert!(context.imported("b").is_none());

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

    assert_eq!(sink.error_count(), 1);
}
