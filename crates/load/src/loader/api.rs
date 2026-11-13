//! One api: its base, its layers in apply order, what each layer sees, and the merge.

use std::collections::{HashMap, HashSet};

use indexmap::{IndexMap, IndexSet};
use seampact_authoring::{ApiLayer, FileLayer, JsonObjectExt, RawApi, RawLayer};
use seampact_diagnostics::InternalError;
use seampact_js::Utf16Key;
use seampact_json::{JsonValue, escape_pointer};
use seampact_span::{Span, location_key};

use super::builds::{BuildId, api_layer_of, root_site_of, site_in};
use super::packs::PackBuild;
use super::{API_LAYER, ApiState, Loader};
use crate::budget::load_work_of;
use crate::compose::merge_layers;
use crate::expand::VisibleDeclaration;
use crate::json::is_reserved_key;
use crate::layer_build::LayerBuild;
use crate::report::{LoadRule, RelatedSite};
use crate::source::FileKind;

/// The layers of one api and the packs each list reached.
struct ApiLayers {
    shared: Option<BuildId>,
    base: Option<BuildId>,
    /// Every pack, in apply order.
    packs: Vec<PackBuild>,
    shared_packs: Vec<PackBuild>,
    base_packs: Vec<PackBuild>,
    /// Every layer, in apply order: packs, shared, base, api.
    order: Vec<BuildId>,
}

/// Per layer, the layers whose names it may resolve, itself included, sorted.
type Visibility = IndexMap<ApiLayer, Vec<ApiLayer>>;

impl Loader<'_, '_> {
    pub(super) fn load_api(
        &mut self,
        name: &str,
        api: BuildId,
        shared: Option<BuildId>,
        apis: &mut Vec<RawApi>,
    ) -> Result<(), InternalError> {
        self.set_layer(API_LAYER);

        if is_reserved_key(name) {
            let at = site_in(self.builds.get(api)?, "/api/name");

            return self.report(
                LoadRule::ReservedKey,
                format!(
                    "'{name}' cannot name an api: it names a property every JavaScript object inherits"
                ),
                "rename the api",
                at,
            );
        }

        let base = self.base_of(api)?;

        self.report_base_extends(shared, base)?;

        let mut state = ApiState {
            order: Vec::new(),
            done: HashSet::new(),
        };
        let shared_packs = match shared {
            Some(shared) => self.apply_list(shared, &mut state)?,
            None => Vec::new(),
        };
        let base_packs = match base {
            Some(base) => self.apply_list(base, &mut state)?,
            None => Vec::new(),
        };

        self.apply_list(api, &mut state)?;

        let order: Vec<BuildId> = state
            .order
            .iter()
            .map(|pack| pack.build)
            .chain(shared)
            .chain(base)
            .chain([api])
            .collect();
        let layers = ApiLayers {
            shared,
            base,
            packs: state.order,
            shared_packs,
            base_packs,
            order,
        };
        let api_site = root_site_of(self.builds.get(api)?);
        let visibility = self.visibility_of(&layers, api_site)?;

        self.finish_layers(&layers, &visibility, api_site)?;
        self.report_invisible_names(&layers, &visibility, api_site)?;
        self.set_layer(API_LAYER);

        let raw_api = self.merge_api(name, &layers, visibility)?;

        apis.push(raw_api);

        Ok(())
    }

    /// The base an api extends, read as a `base` layer.
    fn base_of(&mut self, api: BuildId) -> Result<Option<BuildId>, InternalError> {
        let build = self.builds.get(api)?;
        let extends = build.tree.member("extends").cloned();
        let at = site_in(build, "/extends");
        let api_path = build.parsed.path.clone();
        let api_boundary = build.parsed.boundary.clone();

        let Some(extends) = extends else {
            return Ok(None);
        };
        let JsonValue::String(path) = extends else {
            self.report(
                LoadRule::ExtendsShape,
                "an api extends at most one base, written as a path".to_owned(),
                "write extends: ./base.yaml",
                at,
            )?;

            return Ok(None);
        };
        let from = self.written_in(api, at)?;
        let Some(resolved) = self.resolve_written(&from, &path, at, FileKind::Extends)? else {
            return Ok(None);
        };

        if resolved.path == api_path {
            self.report(
                LoadRule::ExtendsCycle,
                format!(
                    "the api extends itself (P8): {} -> {}",
                    resolved.path, resolved.path
                ),
                "break the cycle: extend a base file",
                at,
            )?;

            return Ok(None);
        }

        let base_layer = FileLayer::Api(ApiLayer::Base);
        let Some(parsed) = self.parse_as(&resolved.path, &api_boundary, base_layer.clone())? else {
            return Ok(None);
        };

        Ok(Some(self.layer(&parsed, base_layer)?))
    }

    fn report_base_extends(
        &mut self,
        shared: Option<BuildId>,
        base: Option<BuildId>,
    ) -> Result<(), InternalError> {
        for (what, layer) in [("shared file", shared), ("base", base)] {
            let Some(layer) = layer else {
                continue;
            };
            let build = self.builds.get(layer)?;

            if !build.tree.contains_key("extends") {
                continue;
            }

            let message = format!(
                "a {what} extends nothing (the file '{}' has extends)",
                build.parsed.path
            );
            let at = site_in(build, "/extends");
            let build_layer = build.layer.clone();

            self.set_layer(build_layer);
            self.report(
                LoadRule::BaseExtends,
                message,
                "what every api shares goes in the workspace's shared file; anything beyond travels as packs",
                at,
            )?;
        }

        Ok(())
    }

    /// Layer names clash: the layer id is the pack name, so two packs of one name are one layer.
    /// Each pack visited is charged: an api recomputes the closure of every pack it applies.
    fn visibility_of(
        &mut self,
        layers: &ApiLayers,
        api_site: Span,
    ) -> Result<Visibility, InternalError> {
        let shared_sees = match layers.shared {
            Some(_) => self.with_closure(ApiLayer::Shared, &layers.shared_packs, api_site)?,
            None => Vec::new(),
        };
        let mut base_sees = Vec::new();

        if layers.base.is_some() {
            base_sees = self.with_closure(ApiLayer::Base, &layers.base_packs, api_site)?;
            base_sees.extend(shared_sees.iter().cloned());
        }

        let mut visibility = Visibility::new();

        for pack in &layers.packs {
            let layer = api_layer_of(self.builds.get(pack.build)?)?;
            let mut sees = self.closure_names(std::slice::from_ref(pack), api_site)?;

            sort_layers(&mut sees);
            visibility.insert(layer, sees);
        }

        if layers.shared.is_some() {
            let mut sees = shared_sees;

            sort_layers(&mut sees);
            visibility.insert(ApiLayer::Shared, sees);
        }

        if layers.base.is_some() {
            let mut sees: Vec<ApiLayer> = base_sees
                .into_iter()
                .collect::<IndexSet<ApiLayer>>()
                .into_iter()
                .collect();

            sort_layers(&mut sees);
            visibility.insert(ApiLayer::Base, sees);
        }

        let mut own_layers = Vec::with_capacity(layers.order.len());

        for build in &layers.order {
            own_layers.push(api_layer_of(self.builds.get(*build)?)?);
        }

        sort_layers(&mut own_layers);
        visibility.insert(ApiLayer::Api, own_layers);

        Ok(visibility)
    }

    /// `[layer, ...the layers of the packs' closure]`.
    fn with_closure(
        &mut self,
        layer: ApiLayer,
        packs: &[PackBuild],
        api_site: Span,
    ) -> Result<Vec<ApiLayer>, InternalError> {
        let mut sees = vec![layer];

        sees.extend(self.closure_names(packs, api_site)?);

        Ok(sees)
    }

    fn closure_names(
        &mut self,
        packs: &[PackBuild],
        api_site: Span,
    ) -> Result<Vec<ApiLayer>, InternalError> {
        let mut keys: IndexSet<String> = IndexSet::new();

        for pack in packs {
            let mut seen = IndexSet::new();

            self.pack_closure(pack, &mut seen, api_site)?;
            keys.extend(seen);
        }

        let mut names = Vec::with_capacity(keys.len());

        for key in &keys {
            names.push(self.pack_layer_of_key(key)?);
        }

        Ok(names)
    }

    fn pack_layer_of_key(&self, key: &str) -> Result<ApiLayer, InternalError> {
        let Some(Some(pack)) = self.packs.get(key) else {
            return Err(InternalError::new(format!(
                "the pack '{key}' is not loaded"
            )));
        };

        api_layer_of(self.builds.get(pack.build)?)
    }

    /// The packs a pack builds on, itself first, charged one unit each.
    fn pack_closure(
        &mut self,
        pack: &PackBuild,
        seen: &mut IndexSet<String>,
        api_site: Span,
    ) -> Result<(), InternalError> {
        if seen.contains(&pack.key) || !self.charge(1, api_site)? {
            return Ok(());
        }

        seen.insert(pack.key.clone());

        for extended in &pack.extends_refs {
            if let Some(sub) = self.find_pack(&extended.reference, extended.at)? {
                self.pack_closure(&sub, seen, api_site)?;
            }
        }

        Ok(())
    }

    /// Finishes each layer once its visible layers are finished: schema files reached by `$ref`.
    fn finish_layers(
        &mut self,
        layers: &ApiLayers,
        visibility: &Visibility,
        api_site: Span,
    ) -> Result<(), InternalError> {
        let mut by_layer: HashMap<ApiLayer, BuildId> = HashMap::new();

        for id in &layers.order {
            by_layer.insert(api_layer_of(self.builds.get(*id)?)?, *id);
        }

        for &id in &layers.order {
            if !self.finished.insert(id) {
                continue;
            }

            let layer = api_layer_of(self.builds.get(id)?)?;
            let sees = visibility.get(&layer).cloned().unwrap_or_default();

            self.set_layer(FileLayer::Api(layer.clone()));

            let mut build = self.builds.take(id)?;
            let builds = &self.builds;
            let finished = self.expander.finish_refs(&mut build, |expander, name| {
                let parts = expander.parts();
                let units = u64::try_from(sees.len()).unwrap_or(u64::MAX);

                if !parts
                    .budget
                    .charge(units, || api_site, parts.reporter, parts.store.files())?
                {
                    return Ok(None);
                }

                for visible in &sees {
                    if *visible == layer {
                        continue;
                    }

                    let Some(other) = by_layer.get(visible) else {
                        continue;
                    };
                    let other = builds.get(*other)?;

                    if !other
                        .tree
                        .object("schemas")
                        .is_some_and(|schemas| schemas.contains_key(name))
                    {
                        continue;
                    }

                    let at = format!("/schemas/{}", escape_pointer(name));

                    return Ok(Some(VisibleDeclaration {
                        site: other.locs.get(&at).copied(),
                        layer: FileLayer::Api(visible.clone()),
                        source: other.sources.get(&at).cloned(),
                    }));
                }

                Ok(None)
            });

            self.builds.restore(id, build)?;
            finished?;
        }

        Ok(())
    }

    /// Names a layer uses but only a layer it does not build on declares. The declaring layers of
    /// each name are indexed once per api, in application order, and every lookup is charged.
    fn report_invisible_names(
        &mut self,
        layers: &ApiLayers,
        visibility: &Visibility,
        api_site: Span,
    ) -> Result<(), InternalError> {
        let declared_by = self.declaring_layers(layers, api_site)?;

        for &id in &layers.order {
            let layer = api_layer_of(self.builds.get(id)?)?;
            let sees: HashSet<&ApiLayer> = visibility
                .get(&layer)
                .map(|visible| visible.iter().collect())
                .unwrap_or_default();
            let uses = self.builds.get(id)?.uses.clone();

            for used in uses {
                let declaring: &[BuildId] = declared_by.get(&used.name).map_or(&[], Vec::as_slice);
                let units = 1 + u64::try_from(declaring.len()).unwrap_or(u64::MAX);

                if !self.charge(units, api_site)? {
                    break;
                }

                if self.declares_visibly(id, declaring, &sees)? {
                    continue;
                }

                let Some(&other) = declaring.first() else {
                    continue;
                };

                self.report_not_visible(id, other, &used.name, used.at)?;
            }
        }

        Ok(())
    }

    fn declaring_layers(
        &mut self,
        layers: &ApiLayers,
        api_site: Span,
    ) -> Result<HashMap<String, Vec<BuildId>>, InternalError> {
        let mut declared_by: HashMap<String, Vec<BuildId>> = HashMap::new();

        for &id in &layers.order {
            let tree = &self.builds.get(id)?.tree;
            let names: Vec<String> = ["schemas", "enums"]
                .into_iter()
                .filter_map(|section| tree.object(section))
                .flat_map(|section| section.keys().cloned())
                .collect();

            for name in names {
                if !self.charge(1, api_site)? {
                    break;
                }

                let list = declared_by.entry(name).or_default();

                if list.last() != Some(&id) {
                    list.push(id);
                }
            }
        }

        Ok(declared_by)
    }

    /// Whether one of the declaring layers is the layer itself or one it sees.
    fn declares_visibly(
        &self,
        id: BuildId,
        declaring: &[BuildId],
        sees: &HashSet<&ApiLayer>,
    ) -> Result<bool, InternalError> {
        for &other in declaring {
            if other == id || sees.contains(&api_layer_of(self.builds.get(other)?)?) {
                return Ok(true);
            }
        }

        Ok(false)
    }

    fn report_not_visible(
        &mut self,
        id: BuildId,
        other: BuildId,
        name: &str,
        used_at: Span,
    ) -> Result<(), InternalError> {
        let used_in = self.file_path_of(used_at)?;
        let (user_layer, other_layer, other_path, declared_at) = {
            let user = self.builds.get(id)?;
            let declaring = self.builds.get(other)?;
            let pointer = format!("/schemas/{}", escape_pointer(name));
            let enum_pointer = format!("/enums/{}", escape_pointer(name));
            let declared_at = declaring
                .locs
                .get(&pointer)
                .or_else(|| declaring.locs.get(&enum_pointer))
                .copied()
                .unwrap_or_else(|| root_site_of(declaring));

            (
                user.layer.clone(),
                declaring.layer.to_string(),
                declaring.parsed.path.clone(),
                declared_at,
            )
        };

        self.set_layer(user_layer.clone());
        self.report_related(
            LoadRule::NameNotVisible,
            format!(
                "'{name}' is used in '{used_in}' but declared only in '{other_path}' (layer '{other_layer}'), which '{user_layer}' does not build on"
            ),
            "move the declaration into the shared file or the base",
            used_at,
            vec![RelatedSite {
                at: declared_at,
                message: "declared here".to_owned(),
            }],
        )
    }

    /// Merges the layers, and gives the api's own table (ADR 0004 section 11), keyed exactly as its
    /// origins serialise. Each entry is charged: a layer shared by many apis is written into each
    /// one's table.
    fn merge_api(
        &mut self,
        name: &str,
        layers: &ApiLayers,
        visibility: Visibility,
    ) -> Result<RawApi, InternalError> {
        let mut layer_builds: Vec<LayerBuild> = Vec::with_capacity(layers.order.len());

        for id in &layers.order {
            layer_builds.push(self.builds.get(*id)?.clone());
        }

        let merged = {
            let parts = self.expander.parts();

            merge_layers(
                &layer_builds,
                parts.reporter,
                parts.store.files(),
                parts.budget,
            )?
        };
        let mut locations = IndexMap::new();

        for build in &layer_builds {
            for (pointer, site) in &build.locs {
                let key = location_key(&build.layer, pointer);

                if !self.charge(load_work_of(&key), *site)? {
                    break;
                }

                locations.insert(key, *site);
            }
        }

        let mut raw_layers = Vec::with_capacity(layer_builds.len());

        for build in layer_builds {
            raw_layers.push(RawLayer {
                layer: api_layer_of(&build)?,
                file: build.parsed.path.clone(),
                tree: build.tree,
            });
        }

        Ok(RawApi {
            name: name.to_owned(),
            layers: raw_layers,
            merged: merged.merged,
            leaf_origins: merged.leaf_origins,
            locations,
            visibility,
        })
    }
}

/// `Array.prototype.sort` on layer ids: by UTF-16 code units, stable.
fn sort_layers(layers: &mut [ApiLayer]) {
    layers.sort_by_cached_key(|layer| Utf16Key::new(layer.to_string()));
}
