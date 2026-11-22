//! What `seampact init` writes in a new project: the app config and a contract that compiles as
//! written.

/// The folder of the starter contract, as the getting-started guide names it.
pub(crate) const STARTER_SOURCE_DIRECTORY: &str = "contract";

/// The contract's single api file: the entry of a workspace without `workspace.yaml`.
pub(crate) const STARTER_CONTRACT_FILE: &str = "api.yaml";

/// `--blank`: the api header alone; otherwise a small example to edit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StarterContent {
    Example,
    Blank,
}

const EXAMPLE_API: &str = "notes";
const BLANK_API: &str = "api";

const BLANK_CONTRACT: &str =
    "# The contract of your api. Add its schemas and routes, then run `seampact compile`.
api:
  name: api
  version: 1
  kind: product
  maturity: provisional
  summary: The api this app serves.
";

const EXAMPLE_CONTRACT: &str =
    "# An example contract: one api with a collection of notes, listed and read.
# Edit it or replace it, then run `seampact compile`.
api:
  name: notes
  version: 1
  kind: product
  maturity: provisional
  summary: A small notes api.

# How a list is paged: a cursor and a limit in the query, the next page in the links.
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }

# The data the routes send.
schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }

# The routes, under /v1. `access` says who may call them.
surfaces:
  app:
    prefix: /v{version}
    access: { public: \"Anyone may call this api: it has no accounts.\" }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          # Lists the notes, a page at a time.
          list: { paging: { cursor: { maxLimit: 50 } } }
          # Reads one note by its noteId.
          get: {}
";

/// The app config of a new project; its source is named after its api.
pub(crate) fn starter_config(content: StarterContent) -> String {
    let api = match content {
        StarterContent::Blank => BLANK_API,
        StarterContent::Example => EXAMPLE_API,
    };

    format!(
        "# Where the contract is and what seampact generates from it.
outDir: src/__generated__
sources:
  {api}:
    path: ./{STARTER_SOURCE_DIRECTORY}
targets:
  # The TypeScript types of the api (npm package @seampact/codegen-ts). Add a server or a client target beside it.
  - id: types
    use: \"@seampact/codegen-ts\"
    apis: [{api}]
"
    )
}

/// The contract of a new project.
pub(crate) fn starter_contract(content: StarterContent) -> &'static str {
    match content {
        StarterContent::Blank => BLANK_CONTRACT,
        StarterContent::Example => EXAMPLE_CONTRACT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_contract_names_the_api_its_config_names() {
        for (content, api) in [
            (StarterContent::Blank, BLANK_API),
            (StarterContent::Example, EXAMPLE_API),
        ] {
            assert!(
                starter_contract(content).contains(&format!("\n  name: {api}\n")),
                "content {content:?}"
            );
            assert!(
                starter_config(content).contains(&format!("apis: [{api}]")),
                "content {content:?}"
            );
        }
    }
}
