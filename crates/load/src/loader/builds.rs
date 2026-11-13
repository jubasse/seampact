//! The layer builds of one load, held once and named by handle.

use seampact_authoring::{ApiLayer, FileLayer};
use seampact_diagnostics::InternalError;
use seampact_span::Span;

use crate::layer_build::LayerBuild;
use crate::source::node_span;

/// A layer build of the load. Two apis that build on one file hold the same handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct BuildId(usize);

/// Every layer build of a load. The TypeScript shared them by reference; a handle stands for that
/// identity, and a build being finished is taken out of its slot so the others stay readable.
#[derive(Debug, Default)]
pub(super) struct Builds {
    slots: Vec<Option<LayerBuild>>,
}

impl Builds {
    pub(super) fn push(&mut self, build: LayerBuild) -> BuildId {
        self.slots.push(Some(build));

        BuildId(self.slots.len() - 1)
    }

    pub(super) fn get(&self, id: BuildId) -> Result<&LayerBuild, InternalError> {
        self.slots
            .get(id.0)
            .and_then(Option::as_ref)
            .ok_or_else(|| InternalError::new(format!("layer build {} is not held", id.0)))
    }

    pub(super) fn take(&mut self, id: BuildId) -> Result<LayerBuild, InternalError> {
        self.slots
            .get_mut(id.0)
            .and_then(Option::take)
            .ok_or_else(|| InternalError::new(format!("layer build {} is not held", id.0)))
    }

    pub(super) fn restore(&mut self, id: BuildId, build: LayerBuild) -> Result<(), InternalError> {
        match self.slots.get_mut(id.0) {
            Some(slot @ None) => {
                *slot = Some(build);

                Ok(())
            }
            _ => Err(InternalError::new(format!(
                "layer build {} is already held",
                id.0
            ))),
        }
    }
}

/// Where `pointer` of the layer is written, or the start of its file when it is not located: the
/// TypeScript `build.locs.get(pointer) ?? nodeSite(parsed, parsed.root)`.
pub(super) fn site_in(build: &LayerBuild, pointer: &str) -> Span {
    build
        .locs
        .get(pointer)
        .copied()
        .unwrap_or_else(|| root_site_of(build))
}

/// The root node of the layer's file, or its start.
pub(super) fn root_site_of(build: &LayerBuild) -> Span {
    node_span(&build.parsed, build.parsed.root.as_ref())
}

/// The layer of a build that belongs to an api; the workspace entry belongs to none.
pub(super) fn api_layer_of(build: &LayerBuild) -> Result<ApiLayer, InternalError> {
    match &build.layer {
        FileLayer::Api(layer) => Ok(layer.clone()),
        FileLayer::Workspace => Err(InternalError::new(format!(
            "the workspace entry '{}' is read as a layer of an api",
            build.parsed.path
        ))),
    }
}
