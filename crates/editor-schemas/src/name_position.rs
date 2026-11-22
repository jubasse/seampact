//! The positions of the authoring schemas that name a declaration (grammar section 3).
//!
//! Each one gets the workspace's names of its catalogue in the editor schemas. Every other
//! position keeps checking keywords only: rule, bucket, scheme, scope, nature, format, upstream,
//! successor, an error family.

use crate::editor_catalogue::EditorCatalogue;

/// How a position holds the name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NamePositionForm {
    /// A string next to a `$ref` to a common name definition.
    Name {
        /// The `$ref` the position holds in the published schema.
        holds: &'static str,
    },
    /// A `$ref` to a common list of names.
    List {
        /// The `$ref` the position holds in the published schema.
        holds: &'static str,
    },
    /// The schema reference definition, which also takes a file path.
    Reference,
}

/// One position of a published authoring schema that holds a declared name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NamePosition {
    /// The kind of the authoring file.
    pub(crate) file: &'static str,
    /// JSON Pointer into the published schema of `file`.
    pub(crate) pointer: String,
    /// How the position holds the name.
    pub(crate) form: NamePositionForm,
    /// The catalogue whose names the position lists.
    pub(crate) catalogue: EditorCatalogue,
    /// Words the position takes besides the declared names, with what each means.
    pub(crate) words: &'static [(&'static str, &'static str)],
}

const NAME: &str = "common.schema.json#/$defs/name";
const RIGHT_NAME: &str = "common.schema.json#/$defs/rightName";
const SCHEMA_NAME: &str = "common.schema.json#/$defs/schemaName";
const ERROR_CODE: &str = "common.schema.json#/$defs/errorCode";
const ERROR_CODES: &str = "common.schema.json#/$defs/errorCodes";

const NO_PAGING: &[(&str, &str)] = &[("none", "No paging: the whole list in one response.")];

const NODE_IDENTITIES: &[&str] = &[
    "route",
    "collection",
    "single",
    "scope",
    "surface",
    "op",
    "batchOp",
];
const FILTERED_ROUTES: &[&str] = &["route", "op", "batchOp"];
const LISTING_CATALOGUES: &[&str] = &["identities", "rights", "rules", "scopes"];

fn name_position(
    file: &'static str,
    pointer: &str,
    form: NamePositionForm,
    catalogue: EditorCatalogue,
) -> NamePosition {
    NamePosition {
        file,
        pointer: pointer.to_owned(),
        form,
        catalogue,
        words: &[],
    }
}

fn identity(file: &'static str, pointer: &str) -> NamePosition {
    name_position(
        file,
        pointer,
        NamePositionForm::Name { holds: NAME },
        EditorCatalogue::Identities,
    )
}

fn right(file: &'static str, pointer: &str) -> NamePosition {
    name_position(
        file,
        pointer,
        NamePositionForm::Name { holds: RIGHT_NAME },
        EditorCatalogue::Rights,
    )
}

fn enum_name(file: &'static str, pointer: &str) -> NamePosition {
    name_position(
        file,
        pointer,
        NamePositionForm::Name { holds: SCHEMA_NAME },
        EditorCatalogue::Enums,
    )
}

fn error_code(file: &'static str, pointer: &str) -> NamePosition {
    name_position(
        file,
        pointer,
        NamePositionForm::Name { holds: ERROR_CODE },
        EditorCatalogue::Errors,
    )
}

fn error_codes(file: &'static str, pointer: &str) -> NamePosition {
    name_position(
        file,
        pointer,
        NamePositionForm::List { holds: ERROR_CODES },
        EditorCatalogue::Errors,
    )
}

/// Every position of the published authoring schemas that names a declaration, in published
/// order.
pub(crate) fn name_positions() -> Vec<NamePosition> {
    let mut positions = vec![identity(
        "api",
        "/$defs/api/properties/caller/properties/identity",
    )];

    positions.extend(
        NODE_IDENTITIES
            .iter()
            .map(|def| identity("node", &format!("/$defs/{def}/properties/identity"))),
    );

    positions.push(right(
        "api",
        "/$defs/api/properties/caller/properties/right",
    ));
    positions.push(right("node", "/$defs/requirement/properties/right"));
    positions.push(right(
        "node",
        "/$defs/sortable/items/else/then/properties/right",
    ));
    positions.extend(
        FILTERED_ROUTES
            .iter()
            .map(|def| right("node", &format!("/$defs/{def}/properties/filteredBy"))),
    );
    positions.push(right("schema", "/$defs/restrictedTo/then"));
    positions.push(right(
        "schema",
        "/$defs/restrictedTo/else/then/properties/right",
    ));

    positions.push(name_position(
        "node",
        "/$defs/requires/items/then",
        NamePositionForm::Name { holds: NAME },
        EditorCatalogue::Requirements,
    ));

    positions.push(enum_name("enums", "/$defs/source/properties/enum"));
    positions.push(enum_name(
        "schema",
        "/$defs/plain/properties/enum/else/then",
    ));
    positions.push(enum_name(
        "schema",
        "/$defs/plain/properties/enum/else/else/then/properties/narrow",
    ));

    positions.push(error_codes(
        "conventions",
        "/$defs/conventions/properties/errors/properties/every",
    ));
    positions.extend(
        LISTING_CATALOGUES
            .iter()
            .map(|&file| error_codes(file, "/$defs/entry/properties/errors")),
    );
    positions.push(error_code(
        "identities",
        "/$defs/headerUse/properties/stale",
    ));
    positions.push(error_code(
        "node",
        "/$defs/examples/additionalProperties/properties/error",
    ));
    positions.push(error_code("conventions", "/$defs/roleBinding/then"));
    positions.push(error_code(
        "conventions",
        "/$defs/roleBinding/else/then/properties/code",
    ));
    positions.push(error_codes(
        "pack",
        "/$defs/entry/properties/declareRight/properties/errors",
    ));
    positions.push(error_codes("pack", "/$defs/entry/properties/attachErrors"));

    positions.push(NamePosition {
        words: NO_PAGING,
        ..name_position(
            "node",
            "/$defs/paging/then",
            NamePositionForm::Name { holds: NAME },
            EditorCatalogue::Pagings,
        )
    });
    positions.push(name_position(
        "conventions",
        "/$defs/conventions/properties/paging/properties/default",
        NamePositionForm::Name { holds: NAME },
        EditorCatalogue::Pagings,
    ));

    positions.push(name_position(
        "schema",
        "/$defs/reference",
        NamePositionForm::Reference,
        EditorCatalogue::Schemas,
    ));
    positions.push(name_position(
        "rights",
        "/$defs/subject/properties/resource",
        NamePositionForm::Name { holds: SCHEMA_NAME },
        EditorCatalogue::Schemas,
    ));

    positions
}
