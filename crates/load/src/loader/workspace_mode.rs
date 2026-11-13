//! A workspace file: the shared file, then each api it names.

use seampact_authoring::{ApiLayer, FileLayer, JsonObjectExt, RawApi, RawWorkspaceConfig};
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue, escape_pointer};
use seampact_span::Span;

use super::builds::{BuildId, site_in};
use super::{API_LAYER, Loader};
use crate::ROOT_BOUNDARY;
use crate::json::show_value;
use crate::report::{LoadRule, RelatedSite};
use crate::source::{FileKind, PathContext, ResolvedFile};

/// Where a path is written: the file that wrote it (an included file when an `$include` brought
/// the key) and the boundary of the layer.
pub(super) struct WrittenIn {
    path: String,
    boundary: String,
}

impl WrittenIn {
    pub(super) fn context(&self) -> PathContext<'_> {
        PathContext {
            path: &self.path,
            boundary: &self.boundary,
        }
    }
}

impl Loader<'_, '_> {
    /// ADR 0002 section 2, rule 3: a relative path resolves against the file that wrote it, which
    /// is an included file when an `$include` brought the key. `at` is where the path is written;
    /// the boundary stays the layer's (the workspace root, or a pack's package).
    pub(super) fn written_in(
        &mut self,
        build: BuildId,
        at: Span,
    ) -> Result<WrittenIn, InternalError> {
        let boundary = self.builds.get(build)?.parsed.boundary.clone();

        Ok(WrittenIn {
            path: self.file_path_of(at)?,
            boundary,
        })
    }

    pub(super) fn resolve_written(
        &mut self,
        from: &WrittenIn,
        raw: &str,
        at: Span,
        kind: FileKind,
    ) -> Result<Option<ResolvedFile>, InternalError> {
        let parts = self.expander.parts();

        parts
            .store
            .resolve(parts.reporter, from.context(), raw, at, kind)
    }

    pub(super) fn workspace_mode(
        &mut self,
        entry: BuildId,
        workspace: &JsonObject,
        apis: &mut Vec<RawApi>,
        config: &mut RawWorkspaceConfig,
    ) -> Result<(), InternalError> {
        if let Some(editor_schemas) = workspace.string("editorSchemas") {
            config.editor_schemas = Some(editor_schemas.to_owned());
        }

        if let Some(imports) = workspace.member("imports") {
            config.imports = Some(imports.clone());
        }

        let listed = workspace.object("apis").filter(|list| !list.is_empty());
        let Some(listed) = listed else {
            return self.bad_shape(
                entry,
                "/workspace",
                "workspace.apis maps no api",
                "write workspace: { apis: { <name>: ./api.yaml } }",
            );
        };
        let shared = self.shared_file(entry, workspace)?;
        let entry_layer = self.builds.get(entry)?.layer.clone();

        for (name, raw) in listed {
            // Once the budget is spent, the apis left would only report what an empty tree lacks.
            if self.budget_exhausted() {
                break;
            }

            // Each api entry is read from workspace.yaml; loading the api before it moved the layer.
            self.set_layer(entry_layer.clone());

            let at = site_in(
                self.builds.get(entry)?,
                &format!("/workspace/apis/{}", escape_pointer(name)),
            );

            self.load_listed_api(entry, name, raw, at, shared, apis)?;
        }

        Ok(())
    }

    /// `workspace.shared`: the base every api of the workspace builds on.
    fn shared_file(
        &mut self,
        entry: BuildId,
        workspace: &JsonObject,
    ) -> Result<Option<BuildId>, InternalError> {
        let Some(shared) = workspace.member("shared") else {
            return Ok(None);
        };
        let JsonValue::String(path) = shared else {
            self.bad_shape(
                entry,
                "/workspace/shared",
                "workspace.shared takes a path",
                "write shared: ./shared/base.yaml",
            )?;

            return Ok(None);
        };
        let at = site_in(self.builds.get(entry)?, "/workspace/shared");
        let from = self.written_in(entry, at)?;
        let Some(resolved) = self.resolve_written(&from, path, at, FileKind::Workspace)? else {
            return Ok(None);
        };
        let shared_layer = FileLayer::Api(ApiLayer::Shared);
        let Some(parsed) = self.parse_as(&resolved.path, ROOT_BOUNDARY, shared_layer.clone())?
        else {
            return Ok(None);
        };

        Ok(Some(self.layer(&parsed, shared_layer)?))
    }

    fn load_listed_api(
        &mut self,
        entry: BuildId,
        name: &str,
        raw: &JsonValue,
        at: Span,
        shared: Option<BuildId>,
        apis: &mut Vec<RawApi>,
    ) -> Result<(), InternalError> {
        let JsonValue::String(path) = raw else {
            return self.report(
                LoadRule::WorkspaceShape,
                format!("workspace.apis.{name} takes a path"),
                "write the api file's path",
                at,
            );
        };
        let from = self.written_in(entry, at)?;
        let Some(resolved) = self.resolve_written(&from, path, at, FileKind::Workspace)? else {
            return Ok(());
        };
        let Some(parsed) = self.parse_as(&resolved.path, ROOT_BOUNDARY, API_LAYER)? else {
            return Ok(());
        };
        let build = self.layer(&parsed, API_LAYER)?;
        let declared = self
            .builds
            .get(build)?
            .tree
            .object("api")
            .and_then(|api| api.member("name"))
            .cloned();

        self.set_layer(API_LAYER);

        if declared.as_ref() != Some(&JsonValue::String(name.to_owned())) {
            let build_ref = self.builds.get(build)?;
            let name_at = site_in(build_ref, "/api/name");

            self.report_related(
                LoadRule::ApiNameMismatch,
                format!(
                    "workspace.apis names this api '{name}', and api.name is '{}'",
                    show_value(declared.as_ref())
                ),
                "make the two names equal",
                name_at,
                vec![RelatedSite {
                    at,
                    message: "named here".to_owned(),
                }],
            )?;
        }

        self.load_api(name, build, shared, apis)
    }
}
