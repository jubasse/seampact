//! `$file`: the text, the JSON or the YAML of another file, in place of the mapping that names it.

use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;

use super::include::string_of;
use super::{Expander, Scope, StackEntry};
use crate::budget::{load_work_of, utf16_length};
use crate::layer_build::LayerBuild;
use crate::limits::LOAD_MAX_DEPTH;
use crate::report::LoadRule;
use crate::source::{FileKind, node_span, pair_span};
use crate::yaml::YamlPair;

use super::scope::JsonFile;

impl Expander<'_, '_> {
    pub(super) fn file_directive(
        &mut self,
        build: &mut LayerBuild,
        pair: &YamlPair,
        pointer: &str,
        scope: &Scope,
    ) -> Result<JsonValue, InternalError> {
        let file = &scope.file;
        let value_node = pair.value.as_ref();
        let at = pair_span(file, Some(&pair.key), value_node);
        let target = value_node.and_then(|node| string_of(node).map(|path| (node, path)));
        let Some((target_node, written)) = target else {
            self.report(
                LoadRule::DirectiveValue,
                "$file takes a path".to_owned(),
                "write $file: ./docs/text.md",
                at,
            )?;

            return Ok(JsonValue::Null);
        };
        let value_site = node_span(file, Some(target_node));

        // Each site is charged before anything is resolved, and what it reads is charged per use.
        if !self.charge(load_work_of(&written), || value_site)? {
            return Ok(JsonValue::Null);
        }

        if scope.stack.len() >= LOAD_MAX_DEPTH {
            self.report_too_deep(value_site)?;

            return Ok(JsonValue::Null);
        }

        let Some(resolved) = self.store.resolve(
            self.reporter,
            file.path_context(),
            &written,
            value_site,
            FileKind::File,
        )?
        else {
            return Ok(JsonValue::Null);
        };
        let extension = resolved
            .path
            .rsplit_once('.')
            .map_or(resolved.path.as_str(), |(_, extension)| extension)
            .to_lowercase();

        match extension.as_str() {
            "md" | "txt" => self.file_text(&resolved.path, value_site),
            "json" => self.file_json(&resolved.path, &resolved.real, scope, value_site),
            "yaml" | "yml" => self.file_yaml(
                build,
                &resolved.path,
                &resolved.real,
                pointer,
                scope,
                target_node,
            ),
            _ => {
                self.report(
                    LoadRule::FileExtension,
                    format!(
                        "$file reads .md, .txt, .json and .yaml files, not '{}'",
                        resolved.path
                    ),
                    "use one of those extensions",
                    node_span(file, Some(target_node)),
                )?;

                Ok(JsonValue::Null)
            }
        }
    }

    fn file_text(
        &mut self,
        path: &str,
        value_site: seampact_span::Span,
    ) -> Result<JsonValue, InternalError> {
        let Some(file_id) = self.store.raw_text(self.reporter, path)? else {
            return Ok(JsonValue::Null);
        };
        let Some(text) = self.store.text_of(file_id) else {
            return Err(InternalError::new(format!(
                "file '{path}' is in the table with no text"
            )));
        };
        let length = utf16_length(text);

        if !self.charge_text(length, || value_site)? {
            return Ok(JsonValue::Null);
        }

        let Some(text) = self.store.text_of(file_id) else {
            return Err(InternalError::new(format!(
                "file '{path}' is in the table with no text"
            )));
        };

        Ok(JsonValue::String(text.to_owned()))
    }

    fn file_json(
        &mut self,
        path: &str,
        real: &str,
        scope: &Scope,
        value_site: seampact_span::Span,
    ) -> Result<JsonValue, InternalError> {
        let json = self.json_file(path, real, value_site)?;
        let (value, nodes, text, depth) = match &*json {
            JsonFile::Invalid { error } => {
                self.report(
                    LoadRule::FileInvalid,
                    format!("'{path}' is not valid JSON: {error}"),
                    "fix the JSON, or use a .yaml file",
                    value_site,
                )?;

                return Ok(JsonValue::Null);
            }
            JsonFile::TooDeep => {
                self.report_too_deep(value_site)?;

                return Ok(JsonValue::Null);
            }
            JsonFile::Valid {
                value,
                nodes,
                text,
                depth,
            } => (value, *nodes, *text, *depth),
        };

        if scope.depth + depth > LOAD_MAX_DEPTH {
            self.report_too_deep(value_site)?;

            return Ok(JsonValue::Null);
        }

        if !self.charge(nodes, || value_site)? || !self.charge_text(text, || value_site)? {
            return Ok(JsonValue::Null);
        }

        // Each use is its own copy: a layer tree never shares a node between two positions.
        Ok(value.clone())
    }

    fn file_yaml(
        &mut self,
        build: &mut LayerBuild,
        path: &str,
        real: &str,
        pointer: &str,
        scope: &Scope,
        target_node: &crate::yaml::YamlNode,
    ) -> Result<JsonValue, InternalError> {
        let file = &scope.file;
        let Some(parsed) = self.store.parse(self.reporter, path, &file.boundary)? else {
            return Ok(JsonValue::Null);
        };
        let Some(root) = &parsed.root else {
            return Ok(JsonValue::Null);
        };
        let key = format!("{real}#");
        let at = node_span(file, Some(target_node));

        if let Some(first) = scope.stack.iter().position(|entry| entry.key == key) {
            let names: Vec<&str> = scope
                .stack
                .iter()
                .skip(first)
                .map(|entry| entry.shown.as_str())
                .chain(std::iter::once(path))
                .collect();

            self.report(
                LoadRule::IncludeCycle,
                format!("$file cycle (P8): {}", names.join(" -> ")),
                "break the cycle by removing one $file or $include of it",
                at,
            )?;

            return Ok(JsonValue::Null);
        }

        let inner = Scope {
            file: parsed.clone(),
            data: true,
            pos: None,
            parent_key: None,
            stack: scope.stack_with(StackEntry {
                key,
                shown: path.to_owned(),
                at,
            }),
            depth: scope.depth,
        };

        self.node(build, Some(root), pointer, &inner)
    }
}
