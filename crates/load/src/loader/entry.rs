//! The entry file's layer and the layer builds every file is read into once.

use std::rc::Rc;

use seampact_authoring::{ApiLayer, FileLayer};
use seampact_diagnostics::InternalError;

use super::builds::BuildId;
use super::{API_LAYER, Loader};
use crate::source::ParsedFile;
use crate::yaml::{YamlKind, YamlNode};

impl Loader<'_, '_> {
    /// The entry file, read as a workspace file when it holds `workspace:` and as an api file
    /// otherwise. When its own keys do not tell (an `$include` brings them, ADR 0002 section 2),
    /// it is read against both root schemas and takes the kind its keys say once its includes are
    /// resolved; what was reported meanwhile moves to that layer.
    pub(super) fn entry_layer(
        &mut self,
        parsed: &Rc<ParsedFile>,
    ) -> Result<BuildId, InternalError> {
        let own = match &parsed.root {
            Some(YamlNode {
                kind: YamlKind::Mapping(pairs),
                ..
            }) => Some(self.expander.mapping_index(pairs)),
            _ => None,
        };

        if own.as_ref().is_some_and(|own| own.has("workspace")) {
            return self.layer(parsed, FileLayer::Workspace);
        }

        let includes_alone = own
            .as_ref()
            .is_some_and(|own| own.has("$include") && !own.has("api"));

        if !includes_alone {
            return self.layer(parsed, API_LAYER);
        }

        let since = self.reported_count();
        let saved = self.current_layer();

        self.set_layer(FileLayer::Workspace);

        let root = self.expander.parts().positions.entry_root_position()?;
        let build = self
            .expander
            .expand_layer(parsed, FileLayer::Workspace, Some(root))?;

        self.set_layer(saved);

        if build.tree.contains_key("workspace") {
            return Ok(self.builds.push(build));
        }

        self.relabel(since, &FileLayer::Workspace, &API_LAYER);

        let mut as_api = build;

        as_api.layer = FileLayer::Api(ApiLayer::Api);

        Ok(self.builds.push(as_api))
    }

    /// Parses a file as part of `layer`: what parsing finds (P1 to P5, P9, syntax) is that layer's.
    pub(super) fn parse_as(
        &mut self,
        path: &str,
        boundary: &str,
        layer: FileLayer,
    ) -> Result<Option<Rc<ParsedFile>>, InternalError> {
        let saved = self.current_layer();

        self.set_layer(layer);

        let parts = self.expander.parts();
        let parsed = parts.store.parse(parts.reporter, path, boundary);

        self.set_layer(saved);

        parsed
    }

    /// The build of a file as one layer, expanded on first use.
    pub(super) fn layer(
        &mut self,
        parsed: &Rc<ParsedFile>,
        layer: FileLayer,
    ) -> Result<BuildId, InternalError> {
        let key = format!("{layer}|{}|{}", parsed.boundary, parsed.path);

        if let Some(known) = self.cached.get(&key) {
            return Ok(*known);
        }

        let saved = self.current_layer();

        self.set_layer(layer.clone());

        let built = self.expander.expand_layer(parsed, layer, None);

        self.set_layer(saved);

        let id = self.builds.push(built?);

        self.cached.insert(key, id);

        Ok(id)
    }
}
