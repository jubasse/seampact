//! The modeline an editor reads to pick the schema of a contract file, and the file each one goes in.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_authoring::ApiLayer;
use seampact_cli_config::{directory_of, relative_path};
use seampact_load::LoadOutput;

/// The comment an editor reads to pick a file's schema; `compile` never reads it.
const MODELINE_PREFIX: &str = "# yaml-language-server:";

const BYTE_ORDER_MARK: char = '\u{feff}';

const INSTALLED_PACKAGES: &str = "node_modules/";

/// Where the installed `@seampact/spec` keeps its authoring schemas, below the app root
/// (`--editor-schemas=none`).
pub(crate) const INSTALLED_AUTHORING_SCHEMAS: &str =
    "node_modules/@seampact/spec/schemas/authoring";

/// The kind of an authoring schema file: `workspace`, `api`, `base`, `pack` or the kind of an
/// included file (`node-errors`).
pub(crate) type AuthoringFile = &'static str;

/// A file of the workspace that gets no modeline, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileLeftOut {
    pub(crate) file: String,
    pub(crate) reason: &'static str,
}

/// Each file the load read with the schema it is checked against, and those left out.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct WorkspaceFileKinds {
    /// Root-relative file to the authoring schema kind, in the order the load read them.
    pub(crate) kinds: IndexMap<String, AuthoringFile>,
    pub(crate) left_out: Vec<FileLeftOut>,
}

/// The modeline of `file` (absolute) pointing at the schema of `kind` in `schema_directory`,
/// relative to the file.
pub(crate) fn modeline_of(
    file: &Utf8Path,
    schema_directory: &Utf8Path,
    kind: AuthoringFile,
) -> String {
    let directory = relative_path(&directory_of(file), schema_directory);
    let schema = format!("{kind}.schema.json");

    if directory.as_str().is_empty() {
        return format!("{MODELINE_PREFIX} $schema={schema}");
    }

    format!("{MODELINE_PREFIX} $schema={directory}/{schema}")
}

/// `text` with `modeline` as its first line: a first line that is a modeline is replaced, else the
/// modeline is put before it. A byte order mark stays first; the line end is the text's own.
pub(crate) fn with_modeline(text: &str, modeline: &str) -> String {
    let (mark, body) = match text.strip_prefix(BYTE_ORDER_MARK) {
        Some(body) => (BYTE_ORDER_MARK.to_string(), body),
        None => (String::new(), text),
    };
    let first_line_end = crate::line_end::first_line_end(body);

    if !body.starts_with(MODELINE_PREFIX) {
        let end = first_line_end.map_or("\n", |(_, end)| end);

        return format!("{mark}{modeline}{end}{body}");
    }

    let rest = match first_line_end {
        Some((start, _)) => body.get(start..).unwrap_or_default(),
        None => "",
    };

    format!("{mark}{modeline}{rest}")
}

fn layer_file_kind(layer: &ApiLayer) -> AuthoringFile {
    match layer {
        ApiLayer::Api => "api",
        ApiLayer::Pack(_) => "pack",
        ApiLayer::Shared | ApiLayer::Base => "base",
    }
}

/// The kind `file` gets, or why it gets none.
#[expect(
    clippy::case_sensitive_file_extension_comparisons,
    reason = "the TypeScript tests /\\.ya?ml$/, which is case-sensitive"
)]
fn single_kind(
    file: &str,
    kinds: Option<&Vec<Option<AuthoringFile>>>,
    partial: &[&str],
) -> Result<AuthoringFile, &'static str> {
    if file.starts_with(INSTALLED_PACKAGES) || file.contains(&format!("/{INSTALLED_PACKAGES}")) {
        return Err("an installed package");
    }

    if !file.ends_with(".yaml") && !file.ends_with(".yml") {
        return Err("not a YAML file, so it holds no comment");
    }

    if partial.contains(&file) {
        return Err("included in part, so no one schema checks the whole file");
    }

    match kinds.map(Vec::as_slice) {
        Some([Some(kind)]) => Ok(kind),
        _ => Err("its include sites expect no single kind"),
    }
}

fn add_candidate<'load>(
    candidates: &mut IndexMap<&'load str, Vec<Option<AuthoringFile>>>,
    file: &'load str,
    kind: Option<AuthoringFile>,
) {
    let kinds = candidates.entry(file).or_default();

    if !kinds.contains(&kind) {
        kinds.push(kind);
    }
}

/// Each file the load read, with its kind: the entry `workspace.yaml`, an api file, a base, a pack
/// of the workspace, then each included file by the kind its include site expects.
pub(crate) fn workspace_file_kinds(load: &LoadOutput) -> WorkspaceFileKinds {
    let mut candidates: IndexMap<&str, Vec<Option<AuthoringFile>>> = IndexMap::new();
    let mut partial: Vec<&str> = Vec::new();

    if let Some(entry) = &load.workspace.entry {
        add_candidate(&mut candidates, &entry.file, Some("workspace"));
    }

    for layer in load.workspace.apis.iter().flat_map(|api| &api.layers) {
        add_candidate(
            &mut candidates,
            &layer.file,
            Some(layer_file_kind(&layer.layer)),
        );
    }

    for fragment in &load.fragments {
        if fragment.pointer.is_none() {
            add_candidate(&mut candidates, &fragment.file, fragment.kind);
        } else {
            partial.push(&fragment.file);
        }
    }

    let mut file_kinds = WorkspaceFileKinds::default();

    for file in &load.read_files {
        match single_kind(file, candidates.get(file.as_str()), &partial) {
            Ok(kind) => {
                file_kinds.kinds.insert(file.clone(), kind);
            }
            Err(reason) => file_kinds.left_out.push(FileLeftOut {
                file: file.clone(),
                reason,
            }),
        }
    }

    file_kinds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_modeline_replaces_the_first_line_when_it_is_one_and_goes_before_it_otherwise() {
        let modeline = "# yaml-language-server: $schema=new.json";
        let cases = [
            (
                "api: x\n",
                "# yaml-language-server: $schema=new.json\napi: x\n",
            ),
            (
                "api: x\r\n",
                "# yaml-language-server: $schema=new.json\r\napi: x\r\n",
            ),
            (
                "# yaml-language-server: $schema=old.json\r\napi: x",
                "# yaml-language-server: $schema=new.json\r\napi: x",
            ),
            (
                "# yaml-language-server: $schema=old.json",
                "# yaml-language-server: $schema=new.json",
            ),
            (
                "\u{feff}api: x",
                "\u{feff}# yaml-language-server: $schema=new.json\napi: x",
            ),
            ("", "# yaml-language-server: $schema=new.json\n"),
        ];

        for (text, expected) in cases {
            assert_eq!(with_modeline(text, modeline), expected, "text {text:?}");
        }
    }

    #[test]
    fn a_modeline_points_at_the_schema_relative_to_its_file() {
        let file = Utf8Path::new("/app/contract/api.yaml");

        for (schemas, expected) in [
            (
                "/app/contract/.seampact/schemas",
                ".seampact/schemas/api.schema.json",
            ),
            ("/app/node_modules/x", "../node_modules/x/api.schema.json"),
            ("/app/contract", "api.schema.json"),
        ] {
            assert_eq!(
                modeline_of(file, Utf8Path::new(schemas), "api"),
                format!("# yaml-language-server: $schema={expected}"),
                "schemas {schemas}"
            );
        }
    }

    #[test]
    fn a_file_gets_a_kind_only_when_every_site_agrees_on_one() {
        let one = vec![Some("api")];
        let two = vec![Some("api"), Some("base")];
        let unknown = vec![None];

        assert_eq!(single_kind("api.yaml", Some(&one), &[]), Ok("api"));
        assert_eq!(
            single_kind("api.yaml", Some(&two), &[]),
            Err("its include sites expect no single kind")
        );
        assert_eq!(
            single_kind("api.yaml", Some(&unknown), &[]),
            Err("its include sites expect no single kind")
        );
        assert_eq!(
            single_kind("a.txt", Some(&one), &[]),
            Err("not a YAML file, so it holds no comment")
        );
        assert_eq!(
            single_kind("x/node_modules/a.yaml", Some(&one), &[]),
            Err("an installed package")
        );
        assert_eq!(
            single_kind("a.yml", Some(&one), &["a.yml"]),
            Err("included in part, so no one schema checks the whole file")
        );
    }
}
