//! The packs of a layer: the `packs` list, the packs each one extends, and one pack file read as a
//! layer named by its manifest.

use seampact_authoring::{ApiLayer, FileLayer, JsonObjectExt};
use seampact_diagnostics::{InternalError, diagnostic_inert};
use seampact_ir::PackName;
use seampact_json::{JsonValue, escape_pointer};
use seampact_span::Span;

use super::builds::{BuildId, root_site_of, site_in};
use super::package::{PackageFound, js_text_of};
use super::{ApiState, Loader};
use crate::limits::LOAD_MAX_DEPTH;
use crate::pack_files::pack_layer_id_of;
use crate::report::{LoadRule, RelatedSite};
use crate::source::{FileKind, ParsedFile, node_span};
use crate::yaml::YamlKind;

/// The keys a pack may hold (ADR 0002 section 1, table of file kinds).
const PACK_KEYS: [&str; 21] = [
    "pack",
    "schemas",
    "enums",
    "scalars",
    "errors",
    "natures",
    "schemes",
    "headers",
    "identities",
    "rights",
    "rules",
    "requirements",
    "scopes",
    "buckets",
    "services",
    "pagings",
    "formats",
    "conventions",
    "extensions",
    "lint",
    "derive",
];

/// The name a pack file is read under until its manifest names it; never a layer of a raw tree.
const PROVISIONAL_PACK_NAME: &str = "\0naming";

fn provisional_pack() -> FileLayer {
    FileLayer::Api(ApiLayer::Pack(PackName::new(
        PROVISIONAL_PACK_NAME.to_owned(),
    )))
}

/// A pack another pack, or a layer, names in `extends` or `packs`.
#[derive(Debug, Clone)]
pub(super) struct ExtendsRef {
    /// The reference as written: a path or a package name.
    pub(super) reference: String,
    /// Where it is written.
    pub(super) at: Span,
}

/// A pack loaded as a layer.
#[derive(Debug, Clone)]
pub(super) struct PackBuild {
    /// `<boundary>|<file>`: one pack file read once.
    pub(super) key: String,
    pub(super) name: String,
    pub(super) build: BuildId,
    pub(super) extends_refs: Vec<ExtendsRef>,
}

/// Where a pack file is, and the package it came from when it came from one.
struct PackSource {
    file: String,
    boundary: String,
    package: Option<PackageClaim>,
}

/// What the package says about its pack: the manifest must agree.
struct PackageClaim {
    name: String,
    version: Option<JsonValue>,
}

/// What a pack attempt must undo when the pack is refused.
struct PackAttempt {
    key: String,
    /// How many diagnostics were reported before it.
    since: usize,
    /// The layer that named the pack: the refused pack's diagnostics move to it.
    from_layer: FileLayer,
    /// The layer the reporter was in.
    saved: FileLayer,
}

impl Loader<'_, '_> {
    /// The packs a layer's `packs` list names, each visited with the packs it extends.
    pub(super) fn apply_list(
        &mut self,
        owner: BuildId,
        state: &mut ApiState,
    ) -> Result<Vec<PackBuild>, InternalError> {
        let build = self.builds.get(owner)?;
        let listed = build.tree.member("packs").cloned();
        let owner_layer = build.layer.clone();
        let list_at = site_in(build, "/packs");
        let mut reached = Vec::new();

        let Some(listed) = listed else {
            return Ok(reached);
        };

        self.set_layer(owner_layer.clone());

        let JsonValue::Array(items) = listed else {
            self.report(
                LoadRule::PackShape,
                "packs is a list of paths and package names".to_owned(),
                "write packs: ['@seampact/pack-crud-rights', ./packs/house.yaml]",
                list_at,
            )?;

            return Ok(reached);
        };

        for (index, item) in items.iter().enumerate() {
            let at = site_in(self.builds.get(owner)?, &format!("/packs/{index}"));

            self.set_layer(owner_layer.clone());

            let JsonValue::String(reference) = item else {
                self.report(
                    LoadRule::PackShape,
                    "a pack is named by a path or a package name".to_owned(),
                    "write a string",
                    at,
                )?;

                continue;
            };

            if let Some(pack) = self.load_pack(reference, owner, at)? {
                reached.push(pack.clone());
                self.visit(&pack, &mut Vec::new(), state)?;
            }
        }

        Ok(reached)
    }

    /// Visits a pack after the packs it extends, so `state.order` is the apply order.
    fn visit(
        &mut self,
        pack: &PackBuild,
        stack: &mut Vec<PackBuild>,
        state: &mut ApiState,
    ) -> Result<(), InternalError> {
        if state.done.contains(&pack.key) {
            return Ok(());
        }

        if let Some(start) = stack.iter().position(|member| member.key == pack.key) {
            return self.report_pack_cycle(pack, stack.get(start..).unwrap_or_default());
        }

        if stack.len() >= LOAD_MAX_DEPTH {
            let at = root_site_of(self.builds.get(pack.build)?);
            let parts = self.expander.parts();

            return parts.store.report_too_deep(parts.reporter, at);
        }

        stack.push(pack.clone());

        for extended in &pack.extends_refs {
            let layer = self.builds.get(pack.build)?.layer.clone();

            self.set_layer(layer);

            if let Some(sub) = self.load_pack(&extended.reference, pack.build, extended.at)? {
                self.visit(&sub, stack, state)?;
            }
        }

        stack.pop();
        state.done.insert(pack.key.clone());
        state.order.push(pack.clone());

        Ok(())
    }

    /// `cycle` is the packs of the stack from the first visit of `pack`.
    fn report_pack_cycle(
        &mut self,
        pack: &PackBuild,
        cycle: &[PackBuild],
    ) -> Result<(), InternalError> {
        let pack_build = self.builds.get(pack.build)?;
        let layer = pack_build.layer.clone();
        let at = root_site_of(pack_build);
        let mut paths = Vec::with_capacity(cycle.len() + 1);
        let mut related = Vec::with_capacity(cycle.len());

        for member in cycle {
            let build = self.builds.get(member.build)?;

            paths.push(build.parsed.path.clone());
            related.push(RelatedSite {
                at: site_in(build, "/pack/extends"),
                message: format!("'{}' extends from here", member.name),
            });
        }

        paths.push(pack_build.parsed.path.clone());
        self.set_layer(layer);
        self.report_related(
            LoadRule::PackCycle,
            format!("pack extends cycle (P8): {}", paths.join(" -> ")),
            "break the cycle by removing one extends of it",
            at,
            related,
        )
    }

    /// Keyed by the file that wrote the reference: the same text resolves against that file.
    pub(super) fn find_pack(
        &mut self,
        reference: &str,
        at: Span,
    ) -> Result<Option<PackBuild>, InternalError> {
        let written_in = self.file_path_of(at)?;

        Ok(self
            .pack_keys
            .get(&format!("{written_in}|{reference}"))
            .and_then(|key| self.packs.get(key))
            .and_then(Clone::clone))
    }

    /// Loads the pack `reference` names from `from`: a path, or a package name found in
    /// `node_modules`. A refused pack is remembered as refused.
    pub(super) fn load_pack(
        &mut self,
        reference: &str,
        from: BuildId,
        at: Span,
    ) -> Result<Option<PackBuild>, InternalError> {
        let Some(source) = self.pack_source(reference, from, at)? else {
            return Ok(None);
        };
        let key = format!("{}|{}", source.boundary, source.file);
        let written_in = self.file_path_of(at)?;

        self.pack_keys
            .insert(format!("{written_in}|{reference}"), key.clone());

        if let Some(known) = self.packs.get(&key) {
            return Ok(known.clone());
        }

        let attempt = PackAttempt {
            key,
            since: self.reported_count(),
            from_layer: self.builds.get(from)?.layer.clone(),
            saved: self.current_layer(),
        };

        self.read_pack(reference, &source, attempt)
    }

    fn pack_source(
        &mut self,
        reference: &str,
        from: BuildId,
        at: Span,
    ) -> Result<Option<PackSource>, InternalError> {
        let boundary = self.builds.get(from)?.parsed.boundary.clone();

        if reference.starts_with("./") || reference.starts_with("../") {
            let written = self.written_in(from, at)?;
            let resolved = self.resolve_written(&written, reference, at, FileKind::Pack)?;

            return Ok(resolved.map(|resolved| PackSource {
                file: resolved.path,
                boundary,
                package: None,
            }));
        }

        let found = self.resolve_package(reference, at)?;

        Ok(found.map(|PackageFound { file, dir, version }| PackSource {
            file,
            boundary: dir,
            package: Some(PackageClaim {
                name: reference.to_owned(),
                version,
            }),
        }))
    }

    /// A pack is named by its manifest once its includes are resolved, as the entry file is read:
    /// it is parsed and expanded under a provisional layer, and what was reported meanwhile moves
    /// to `pack:<name>`, or to the layer that names it when the pack is refused.
    fn read_pack(
        &mut self,
        reference: &str,
        source: &PackSource,
        attempt: PackAttempt,
    ) -> Result<Option<PackBuild>, InternalError> {
        self.set_layer(provisional_pack());

        let parsed = {
            let parts = self.expander.parts();

            parts
                .store
                .parse(parts.reporter, &source.file, &source.boundary)?
        };
        let Some(parsed) = parsed.filter(|parsed| parsed.root.is_some()) else {
            return Ok(self.refuse_pack(&attempt));
        };

        // A name written in the file itself and refused is refused before anything is expanded.
        if let Some((written, at)) = self
            .written_pack_name(&parsed)
            .filter(|(written, _)| written.contains('#'))
        {
            self.pack_layer_id(&written, at)?;

            return Ok(self.refuse_pack(&attempt));
        }

        let mut expanded = self
            .expander
            .expand_layer(&parsed, provisional_pack(), None)?;
        let written = expanded
            .tree
            .object("pack")
            .and_then(|manifest| manifest.string("name"));
        let name = written.unwrap_or(reference).to_owned();
        let name_at = site_in(&expanded, "/pack/name");
        let Some(layer_id) = self.pack_layer_id(&name, name_at)? else {
            return Ok(self.refuse_pack(&attempt));
        };

        self.relabel(
            attempt.since,
            &provisional_pack(),
            &FileLayer::Api(layer_id.clone()),
        );
        expanded.layer = FileLayer::Api(layer_id);
        self.set_layer(expanded.layer.clone());

        let build = self.builds.push(expanded);
        let extends_refs = self.check_manifest(build, source)?;

        self.report_foreign_keys(build, &source.file)?;

        let pack = PackBuild {
            key: attempt.key.clone(),
            name: name.clone(),
            build,
            extends_refs,
        };

        self.register_pack_name(&pack)?;
        self.set_layer(attempt.saved);
        self.packs.insert(attempt.key, Some(pack.clone()));

        Ok(Some(pack))
    }

    fn refuse_pack(&mut self, attempt: &PackAttempt) -> Option<PackBuild> {
        self.relabel(attempt.since, &provisional_pack(), &attempt.from_layer);
        self.set_layer(attempt.saved.clone());
        self.packs.insert(attempt.key.clone(), None);

        None
    }

    /// The text of `pack.name` when the file writes it as a string, and where.
    fn written_pack_name(&mut self, parsed: &ParsedFile) -> Option<(String, Span)> {
        let node = self.expander.navigate(parsed, Some("/pack/name"))?;

        if !matches!(node.kind, YamlKind::Scalar { .. }) {
            return None;
        }

        match node.resolved_scalar()? {
            crate::ResolvedScalar::String(text) => Some((text, node_span(parsed, Some(node)))),
            _ => None,
        }
    }

    /// A pack's layer id, `pack:<name>`, built here only. A side table key joins the layer id to a
    /// pointer with `#` (`<layer>#<pointer>`), so a name holding `#` could make a pack's key meet
    /// a load site's (`<layer>#/~load/...`): it is refused, and the pack is not loaded.
    fn pack_layer_id(&mut self, name: &str, at: Span) -> Result<Option<ApiLayer>, InternalError> {
        if !name.contains('#') {
            return Ok(Some(pack_layer_id_of(name)));
        }

        self.report(
            LoadRule::PackName,
            format!("the pack name '{}' holds a '#'", diagnostic_inert(name)),
            "name the pack without '#'",
            at,
        )?;

        Ok(None)
    }

    /// Reports what the manifest lacks or contradicts, and gives the packs it extends.
    fn check_manifest(
        &mut self,
        build: BuildId,
        source: &PackSource,
    ) -> Result<Vec<ExtendsRef>, InternalError> {
        let layer = self.builds.get(build)?;
        let manifest = layer.tree.object("pack").cloned();
        let named = manifest
            .as_ref()
            .and_then(|manifest| Some((manifest.string("name")?, manifest.string("version")?)));
        let Some((manifest_name, manifest_version)) = named else {
            let at = site_in(layer, "/pack");

            self.report(
                LoadRule::PackManifest,
                format!(
                    "the pack file '{}' has no manifest with a name and a version",
                    source.file
                ),
                "start the pack with pack: { name: <name>, version: <semver>, extends: [] }",
                at,
            )?;

            return Ok(Vec::new());
        };
        let extends_refs = self.manifest_extends(build, manifest.as_ref())?;

        if let Some(package) = &source.package {
            self.check_against_package(build, package, manifest_name, manifest_version)?;
        }

        Ok(extends_refs)
    }

    fn manifest_extends(
        &mut self,
        build: BuildId,
        manifest: Option<&seampact_json::JsonObject>,
    ) -> Result<Vec<ExtendsRef>, InternalError> {
        let layer = self.builds.get(build)?;
        let extended = manifest.and_then(|manifest| manifest.member("extends"));

        match extended {
            None => Ok(Vec::new()),
            Some(JsonValue::Array(items)) => Ok(items
                .iter()
                .enumerate()
                .filter_map(|(index, item)| match item {
                    JsonValue::String(reference) => Some(ExtendsRef {
                        reference: reference.clone(),
                        at: site_in(layer, &format!("/pack/extends/{index}")),
                    }),
                    _ => None,
                })
                .collect()),
            Some(_) => {
                let at = site_in(layer, "/pack/extends");

                self.report(
                    LoadRule::PackManifest,
                    "pack.extends is a list of packs".to_owned(),
                    "write extends: []",
                    at,
                )?;

                Ok(Vec::new())
            }
        }
    }

    fn check_against_package(
        &mut self,
        build: BuildId,
        package: &PackageClaim,
        manifest_name: &str,
        manifest_version: &str,
    ) -> Result<(), InternalError> {
        let layer = self.builds.get(build)?;
        let version_at = site_in(layer, "/pack/version");
        let name_at = site_in(layer, "/pack/name");

        if package.version != Some(JsonValue::String(manifest_version.to_owned())) {
            self.report(
                LoadRule::PackVersionMismatch,
                format!(
                    "the pack manifest says version {manifest_version} and the package.json of '{}' says {}",
                    package.name,
                    js_text_of(package.version.as_ref())
                ),
                "write the version once, in the manifest: make package.json agree with it",
                version_at,
            )?;
        }

        if manifest_name != package.name {
            self.report(
                LoadRule::PackNameMismatch,
                format!(
                    "the pack manifest names the pack '{manifest_name}', and it is the package '{}'",
                    package.name
                ),
                "name the pack as its package",
                name_at,
            )?;
        }

        Ok(())
    }

    /// A pack is data only: every key but the pack's own is refused.
    fn report_foreign_keys(&mut self, build: BuildId, file: &str) -> Result<(), InternalError> {
        let layer = self.builds.get(build)?;
        let foreign: Vec<(String, Span)> = layer
            .tree
            .keys()
            .filter(|key| !PACK_KEYS.contains(&key.as_str()))
            .map(|key| {
                (
                    key.clone(),
                    site_in(layer, &format!("/{}", escape_pointer(key))),
                )
            })
            .collect();

        for (key, at) in foreign {
            self.report(
                LoadRule::PackNotData,
                format!("the pack file '{file}' holds '{key}', which is not a pack key; a pack is data only"),
                "keep to the keys of a pack (pack, the catalogues, conventions, formats, extensions, lint, derive)",
                at,
            )?;
        }

        Ok(())
    }

    /// Two packs of one name are one layer: the second is refused.
    fn register_pack_name(&mut self, pack: &PackBuild) -> Result<(), InternalError> {
        let Some(clash) = self.pack_names.get(&pack.name).cloned() else {
            self.pack_names.insert(pack.name.clone(), pack.clone());

            return Ok(());
        };

        if clash.key == pack.key {
            self.pack_names.insert(pack.name.clone(), pack.clone());

            return Ok(());
        }

        let at = site_in(self.builds.get(pack.build)?, "/pack/name");
        let also_at = site_in(self.builds.get(clash.build)?, "/pack/name");

        self.report_related(
            LoadRule::PackNameClash,
            format!("two packs are named '{}'", pack.name),
            "give each pack its own name",
            at,
            vec![RelatedSite {
                at: also_at,
                message: "also named here".to_owned(),
            }],
        )
    }
}
