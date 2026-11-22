//! The catalogue entries an api declares, located, and the names an editor schema lists.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_js::cmp_utf16;
use seampact_pipeline::{PipelineDeclared, derivation_roles};
use seampact_span::{Location, location_key};

use crate::EditorSchemasError;
use crate::editor_catalogue::EditorCatalogue;

/// One catalogue entry an api declares, with the file and line its winning layer writes it at.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EditorDeclaration {
    /// The `catalogue` member.
    pub catalogue: String,
    /// The `name` member.
    pub name: String,
    /// Relative to the workspace root, with forward slashes.
    pub file: String,
    /// The line the entry is declared at.
    pub line: u32,
}

/// The names a position may take: each name with the sentence an editor shows beside it.
pub type EditorNames = IndexMap<EditorCatalogue, IndexMap<String, String>>;

const NODE_MODULES_SEGMENT: &str = "node_modules/";

/// Every entry the api's layers declare, located in the api's side table.
///
/// `locations` is the api's side table resolved to lines, `declared` the api's declared entries
/// (none when finalize produced no IR).
///
/// # Errors
///
/// [`EditorSchemasError::Internal`] when a declaration has no location: the load stage locates
/// every key it merges, so that is a compiler bug.
pub fn editor_declarations(
    api: &str,
    declared: Option<&[PipelineDeclared]>,
    locations: &IndexMap<String, Location>,
) -> Result<Vec<EditorDeclaration>, EditorSchemasError> {
    declared
        .unwrap_or_default()
        .iter()
        .map(|entry| located_declaration(api, entry, locations))
        .collect()
}

fn located_declaration(
    api: &str,
    entry: &PipelineDeclared,
    locations: &IndexMap<String, Location>,
) -> Result<EditorDeclaration, EditorSchemasError> {
    let Origin { layer, pointer, .. } = &entry.origin;
    let key = location_key(layer, pointer);
    let Some(location) = locations.get(&key) else {
        return Err(InternalError::new(format!(
            "the {} entry {} of api {api} has no location ({key})",
            entry.catalogue, entry.id
        ))
        .into());
    };

    Ok(EditorDeclaration {
        catalogue: entry.catalogue.to_owned(),
        name: entry.id.clone(),
        file: location.file.clone(),
        line: location.line,
    })
}

/// The names each editor catalogue lists, each with the sentence naming where it is declared,
/// sorted by name; the `errors` catalogue also holds the default codes seampact supplies.
#[must_use]
pub fn editor_names(declarations: &[EditorDeclaration]) -> EditorNames {
    let mut sites_by_name: IndexMap<EditorCatalogue, IndexMap<&str, Vec<&EditorDeclaration>>> =
        IndexMap::new();

    for declaration in declarations {
        let Some(catalogue) = EditorCatalogue::from_name(&declaration.catalogue) else {
            continue;
        };

        sites_by_name
            .entry(catalogue)
            .or_default()
            .entry(declaration.name.as_str())
            .or_default()
            .push(declaration);
    }

    let mut names: EditorNames = sites_by_name
        .into_iter()
        .map(|(catalogue, by_name)| {
            let sentences = by_name
                .into_iter()
                .map(|(name, sites)| (name.to_owned(), declared_sentence(&sites)))
                .collect();

            (catalogue, sentences)
        })
        .collect();

    add_core_error_codes(&mut names);

    names
        .into_iter()
        .map(|(catalogue, by_name)| (catalogue, sorted_by_name(by_name)))
        .collect()
}

fn declared_sentence(sites: &[&EditorDeclaration]) -> String {
    let mut distinct: IndexMap<(&str, u32), &EditorDeclaration> = IndexMap::new();

    for site in sites {
        distinct.insert((site.file.as_str(), site.line), site);
    }

    let mut ordered: Vec<&EditorDeclaration> = distinct.into_values().collect();

    ordered.sort_by(|left, right| {
        cmp_utf16(&left.file, &right.file).then_with(|| left.line.cmp(&right.line))
    });

    let descriptions: Vec<String> = ordered.into_iter().map(site_description).collect();

    format!("Declared in {}.", descriptions.join("; "))
}

// A pack's file path depends on where node_modules is installed: name the pack instead.
fn site_description(site: &EditorDeclaration) -> String {
    match pack_of(&site.file) {
        Some(pack) => format!("the pack {pack}"),
        None => format!("{} line {}", site.file, site.line),
    }
}

/// The package name of the first `node_modules/<package>/` segment of `file`, the scope included.
///
/// Reads `(?:^|/)node_modules/((?:@[^/]+/)?[^/]+)/`: when the scoped form fails, `@scope` alone
/// followed by a slash is a pack name too, as the regular expression backtracks to it.
fn pack_of(file: &str) -> Option<&str> {
    file.match_indices(NODE_MODULES_SEGMENT)
        .filter(|(start, _)| *start == 0 || file.as_bytes().get(start - 1) == Some(&b'/'))
        .find_map(|(start, segment)| {
            let after = file.get(start + segment.len()..)?;

            scoped_pack(after).or_else(|| pack_name(after))
        })
}

fn scoped_pack(after: &str) -> Option<&str> {
    let (scope, rest) = after.split_once('/')?;

    if !scope.starts_with('@') || scope.len() < 2 {
        return None;
    }

    let name = pack_name(rest)?;

    after.get(..scope.len() + 1 + name.len())
}

fn pack_name(text: &str) -> Option<&str> {
    let (name, _) = text.split_once('/')?;

    if name.is_empty() { None } else { Some(name) }
}

fn add_core_error_codes(names: &mut EditorNames) {
    let errors = names.entry(EditorCatalogue::Errors).or_default();

    for role in derivation_roles() {
        let supplied = format!(
            "Supplied by seampact: the default code of the {} role.",
            role.role.as_str()
        );

        match errors.get_mut(role.default_code) {
            Some(declared) => *declared = format!("{declared} {supplied}"),
            None => {
                errors.insert(role.default_code.to_owned(), supplied);
            }
        }
    }
}

fn sorted_by_name(by_name: IndexMap<String, String>) -> IndexMap<String, String> {
    let mut entries: Vec<(String, String)> = by_name.into_iter().collect();

    entries.sort_by(|(left, _), (right, _)| cmp_utf16(left, right));

    entries.into_iter().collect()
}
