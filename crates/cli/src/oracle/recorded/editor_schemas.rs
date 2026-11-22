//! The recorded calls of the editor schemas: each call's arguments are read from the recording and
//! its result converted back to the JSON the TypeScript wrote.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_editor_schemas::{
    EditorCatalogue, EditorDeclaration, EditorSchemaFile, EditorSchemasPlan, editor_declarations,
    write_editor_schemas,
};
use seampact_ir::{Layer, Origin};
use seampact_json::{JsonNumber, JsonObject, JsonValue, stringify_json};
use seampact_oracle::{ROOT_TOKEN, RecordedAnswer, RecordedToolCall, SubjectAnswer};
use seampact_pipeline::PipelineDeclared;
use seampact_span::Location;

/// Replays a recorded call of the editor schemas on the case root.
pub(super) fn editor_schemas_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    let answer = match call.function.as_str() {
        "editorDeclarations" => editor_declarations_answer(call),
        "writeEditorSchemas" => write_editor_schemas_answer(call, root),
        _ => return SubjectAnswer::NotPorted,
    };

    match answer {
        Ok(answer) => SubjectAnswer::Ported(answer),
        Err(message) => SubjectAnswer::InternalError { message },
    }
}

fn editor_declarations_answer(call: &RecordedToolCall) -> Result<RecordedAnswer, String> {
    let api = call
        .args
        .first()
        .and_then(object_of)
        .ok_or_else(|| malformed(call))?;
    let name = api
        .get("api")
        .and_then(text_of)
        .ok_or_else(|| malformed(call))?;
    let declared = declared_entries(api.get("declared"))?;
    let locations = location_table(api.get("locations")).ok_or_else(|| malformed(call))?;
    let declarations = editor_declarations(name, declared.as_deref(), &locations)
        .map_err(|error| error.to_string())?;

    Ok(RecordedAnswer {
        result: JsonValue::Array(declarations.iter().map(declaration_json).collect()),
        written: IndexMap::new(),
    })
}

fn write_editor_schemas_answer(
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> Result<RecordedAnswer, String> {
    let plan = call
        .args
        .first()
        .and_then(object_of)
        .and_then(|members| plan_of(members, root))
        .ok_or_else(|| malformed(call))?;
    let count = write_editor_schemas(&plan).map_err(|error| error.to_string())?;
    let count = i64::try_from(count).map_err(|error| error.to_string())?;
    let mut written = IndexMap::new();

    for file in &plan.files {
        let target = plan.directory.join(&file.file_name);
        let bytes = fs::read(&target).map_err(|error| format!("{target}: {error}"))?;
        let relative = target
            .strip_prefix(root)
            .map_err(|error| format!("{target}: {error}"))?;

        written.insert(relative.to_string(), bytes);
    }

    Ok(RecordedAnswer {
        result: JsonValue::Number(JsonNumber::from_i64(count)),
        written,
    })
}

fn object_of(value: &JsonValue) -> Option<&JsonObject> {
    match value {
        JsonValue::Object(members) => Some(members),
        _ => None,
    }
}

fn text_of(value: &JsonValue) -> Option<&str> {
    match value {
        JsonValue::String(text) => Some(text),
        _ => None,
    }
}

fn malformed(call: &RecordedToolCall) -> String {
    format!(
        "a recorded {} call with unexpected arguments",
        call.function
    )
}

fn plan_of(members: &JsonObject, root: &Utf8Path) -> Option<EditorSchemasPlan> {
    let directory = text_of(members.get("directory")?)?;
    let JsonValue::Array(files) = members.get("files")? else {
        return None;
    };

    Some(EditorSchemasPlan {
        directory: Utf8PathBuf::from(directory.replace(ROOT_TOKEN, root.as_str())),
        files: files
            .iter()
            .map(schema_file_of)
            .collect::<Option<Vec<_>>>()?,
    })
}

fn schema_file_of(value: &JsonValue) -> Option<EditorSchemaFile> {
    let members = object_of(value)?;

    Some(EditorSchemaFile {
        file_name: text_of(members.get("fileName")?)?.to_owned(),
        text: text_of(members.get("text")?)?.to_owned(),
    })
}

// The recorded catalogues are the editor ones: another name has no consumer yet, so it is refused.
fn declared_entries(value: Option<&JsonValue>) -> Result<Option<Vec<PipelineDeclared>>, String> {
    let Some(JsonValue::Array(entries)) = value else {
        return Ok(None);
    };

    entries
        .iter()
        .map(declared_entry)
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

fn declared_entry(value: &JsonValue) -> Result<PipelineDeclared, String> {
    let entry = object_of(value).ok_or("a declared entry is not an object")?;
    let catalogue = entry
        .get("catalogue")
        .and_then(text_of)
        .and_then(EditorCatalogue::from_name)
        .ok_or("a recorded declared entry names a catalogue the editor schemas do not list")?;
    let id = entry
        .get("id")
        .and_then(text_of)
        .ok_or("a declared entry has no id")?;
    let origin = entry
        .get("origin")
        .and_then(object_of)
        .ok_or("a declared entry has no origin")?;
    let layer = origin
        .get("layer")
        .and_then(text_of)
        .ok_or("a declared origin has no layer")?
        .parse::<Layer>()
        .map_err(|error| error.to_string())?;
    let pointer = origin
        .get("pointer")
        .and_then(text_of)
        .ok_or("a declared origin has no pointer")?;

    Ok(PipelineDeclared {
        catalogue: catalogue.as_str(),
        id: id.to_owned(),
        origin: Origin {
            api: None,
            layer,
            pointer: pointer.to_owned(),
        },
        reached: false,
    })
}

fn location_table(value: Option<&JsonValue>) -> Option<IndexMap<String, Location>> {
    let JsonValue::Object(table) = value? else {
        return None;
    };

    table
        .iter()
        .map(|(key, location)| Some((key.clone(), location_of(object_of(location)?)?)))
        .collect()
}

fn location_of(members: &JsonObject) -> Option<Location> {
    Some(Location {
        file: text_of(members.get("file")?)?.to_owned(),
        line: count_member(members, "line")?,
        column: count_member(members, "column")?,
        end_line: count_member(members, "endLine")?,
        end_column: count_member(members, "endColumn")?,
    })
}

fn count_member(members: &JsonObject, name: &str) -> Option<u32> {
    stringify_json(members.get(name)?).parse().ok()
}

fn declaration_json(declaration: &EditorDeclaration) -> JsonValue {
    let mut members = JsonObject::new();

    members.insert(
        "catalogue".to_owned(),
        JsonValue::String(declaration.catalogue.clone()),
    );
    members.insert(
        "name".to_owned(),
        JsonValue::String(declaration.name.clone()),
    );
    members.insert(
        "file".to_owned(),
        JsonValue::String(declaration.file.clone()),
    );
    members.insert(
        "line".to_owned(),
        JsonValue::Number(JsonNumber::from_i64(i64::from(declaration.line))),
    );

    JsonValue::Object(members)
}
