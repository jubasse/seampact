//! A loaded api built from the JSON text of its layers, standing in for the loader, and the
//! context a half receives over it.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_authoring::{ApiLayer, RawApi, RawLayer, RawWorkspace};
use seampact_diagnostics::{Diagnostic, DiagnosticSink, InternalError};
use seampact_ir::{ImportedIr, Layer, Origin};
use seampact_json::{JsonObject, JsonValue};

use crate::{DraftIr, HalfContext, Inherited, pipeline_conventions, pointer_below};

/// The name of the api every fixture loads.
const FIXTURE_API_NAME: &str = "a";

/// The file every fixture layer is read from.
const FIXTURE_LAYER_FILE: &str = "layer.yaml";

/// The workspace root of every fixture.
const FIXTURE_WORKSPACE_ROOT: &str = ".";

/// One api run as a half sees it: the loaded api, a workspace holding it, the drafts relayed to
/// it, the imported contracts and the sink its diagnostics go to.
#[derive(Debug)]
pub struct HalfFixture {
    raw: RawApi,
    workspace: RawWorkspace,
    relayed: IndexMap<String, DraftIr>,
    imports: IndexMap<String, ImportedIr>,
    sink: DiagnosticSink,
}

impl HalfFixture {
    /// The fixture of an api whose one `api` layer is the JSON object `text`, with no relayed
    /// draft and no import.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when `text` is no JSON object.
    pub fn from_json(text: &str) -> Result<Self, InternalError> {
        Self::from_layers(&[(ApiLayer::Api, text)])
    }

    /// The fixture of an api whose layers are given in application order with their JSON text.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when a layer text is no JSON object.
    pub fn from_layers(layers: &[(ApiLayer, &str)]) -> Result<Self, InternalError> {
        let raw = raw_api_from_layers(layers)?;
        let workspace = RawWorkspace {
            root: Utf8PathBuf::from(FIXTURE_WORKSPACE_ROOT),
            apis: vec![raw.clone()],
            locations: IndexMap::new(),
            entry: None,
            config: None,
        };

        Ok(Self {
            raw,
            workspace,
            relayed: IndexMap::new(),
            imports: IndexMap::new(),
            sink: DiagnosticSink::new(),
        })
    }

    /// The same fixture where `draft` is the derived draft of the workspace api `api`.
    #[must_use]
    pub fn with_relayed(mut self, api: &str, draft: DraftIr) -> Self {
        self.relayed.insert(api.to_owned(), draft);

        self
    }

    /// The same fixture where `imported` is the imported IR of `api`.
    #[must_use]
    pub fn with_import(mut self, api: &str, imported: ImportedIr) -> Self {
        self.imports.insert(api.to_owned(), imported);

        self
    }

    /// The loaded api.
    #[must_use]
    pub const fn raw(&self) -> &RawApi {
        &self.raw
    }

    /// Runs `body` over the context of the api, its conventions and inherited settings read from
    /// the loaded tree; what it reports stays in the fixture's sink.
    ///
    /// The context borrows the conventions and inherited readers built here, so it is lent to a
    /// closure rather than returned.
    ///
    /// # Errors
    ///
    /// The [`InternalError`] of the inherited reader when the loaded tree cannot be read.
    pub fn with_context<R>(
        &mut self,
        body: impl FnOnce(&mut HalfContext<'_>) -> R,
    ) -> Result<R, InternalError> {
        let conventions = pipeline_conventions(&self.raw);
        let inherited = Inherited::new(&self.raw)?;
        let mut context = HalfContext::new(
            &self.raw,
            &self.workspace,
            &conventions,
            &inherited,
            &self.relayed,
            &self.imports,
            &mut self.sink,
        );

        Ok(body(&mut context))
    }

    /// The diagnostics reported so far, in report order.
    #[must_use]
    pub fn into_diagnostics(self) -> Vec<Diagnostic> {
        self.sink.into_diagnostics()
    }
}

/// An api named `a` of one `api` layer, the JSON object `text`.
///
/// # Errors
///
/// An [`InternalError`] when `text` is no JSON object.
pub fn raw_api_from_json(text: &str) -> Result<RawApi, InternalError> {
    raw_api_from_layers(&[(ApiLayer::Api, text)])
}

/// An api named `a` whose layers are given in application order with their JSON text. Objects
/// merge by member and any other value is replaced; each leaf, list and empty object takes the
/// origin of the layer that wrote it last.
///
/// # Errors
///
/// An [`InternalError`] when a layer text is no JSON object.
pub fn raw_api_from_layers(layers: &[(ApiLayer, &str)]) -> Result<RawApi, InternalError> {
    let mut merged = JsonObject::new();
    let mut leaf_origins = IndexMap::new();
    let mut raw_layers = Vec::with_capacity(layers.len());

    for (layer, text) in layers {
        let tree = parse_object(text)?;

        merge(&mut merged, &tree);

        for (key, value) in &tree {
            record_origins(
                value,
                &pointer_below("", &[key.as_str()]),
                layer,
                &mut leaf_origins,
            );
        }

        raw_layers.push(RawLayer {
            layer: layer.clone(),
            file: FIXTURE_LAYER_FILE.to_owned(),
            tree,
        });
    }

    Ok(RawApi {
        name: FIXTURE_API_NAME.to_owned(),
        layers: raw_layers,
        merged,
        leaf_origins,
        locations: IndexMap::new(),
        visibility: IndexMap::new(),
    })
}

/// The origin a fixture gives the `api` layer at `pointer`.
#[must_use]
pub fn api_layer_origin(pointer: &str) -> Origin {
    Origin {
        api: None,
        layer: Layer::Api,
        pointer: pointer.to_owned(),
    }
}

fn parse_object(text: &str) -> Result<JsonObject, InternalError> {
    let value = serde_json::from_str::<JsonValue>(text).map_err(|error| {
        InternalError::new(format!("the fixture layer text is not JSON: {error}"))
    })?;

    match value {
        JsonValue::Object(object) => Ok(object),
        other => Err(InternalError::new(format!(
            "the fixture layer text is not a JSON object: {other:?}"
        ))),
    }
}

// Objects merge by member, any other value (a list included) is replaced, as the layers merge.
fn merge(target: &mut JsonObject, source: &JsonObject) {
    for (key, value) in source {
        match (target.get_mut(key), value) {
            (Some(JsonValue::Object(inner)), JsonValue::Object(incoming)) => {
                merge(inner, incoming);
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

fn record_origins(
    value: &JsonValue,
    pointer: &str,
    layer: &ApiLayer,
    origins: &mut IndexMap<String, Origin>,
) {
    if let JsonValue::Object(object) = value
        && !object.is_empty()
    {
        for (key, item) in object {
            record_origins(
                item,
                &pointer_below(pointer, &[key.as_str()]),
                layer,
                origins,
            );
        }

        return;
    }

    origins.insert(
        pointer.to_owned(),
        Origin {
            api: None,
            layer: Layer::from(layer.clone()),
            pointer: pointer.to_owned(),
        },
    );
}
