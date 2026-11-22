//! The diff codes and the change table as one JSON value, for the oracle.

use seampact_json::{JsonObject, JsonValue};

use crate::diff_cell::DiffCell;
use crate::diff_code::DIFF_CODES;
use crate::diff_table::DIFF_TABLE;
use crate::member_row::MemberRow;
use crate::member_rows_data::MEMBER_ROWS;

/// `{ "codes": DIFF_CODES, "table": DIFF_TABLE, "memberRows": MEMBER_ROWS }` as `JSON.stringify` writes them.
#[must_use]
pub fn diff_table_json() -> JsonValue {
    let codes: JsonObject = DIFF_CODES
        .iter()
        .map(|(member, code)| {
            (
                (*member).to_owned(),
                JsonValue::String(code.as_str().to_owned()),
            )
        })
        .collect();
    let table: JsonObject = DIFF_TABLE
        .iter()
        .map(|(kind, cases)| {
            let cases: JsonObject = cases
                .iter()
                .map(|(case_name, cells)| {
                    let cells: JsonObject = cells
                        .iter()
                        .map(|(position, cell)| (position.as_str().to_owned(), cell_json(cell)))
                        .collect();

                    ((*case_name).to_owned(), JsonValue::Object(cells))
                })
                .collect();

            (kind.as_str().to_owned(), JsonValue::Object(cases))
        })
        .collect();
    let member_rows: JsonObject = MEMBER_ROWS
        .iter()
        .map(|(definition, rows)| {
            let rows: JsonObject = rows
                .iter()
                .map(|(member, row)| ((*member).to_owned(), member_row_json(row)))
                .collect();

            (definition.as_str().to_owned(), JsonValue::Object(rows))
        })
        .collect();
    let mut document = JsonObject::new();

    document.insert("codes".to_owned(), JsonValue::Object(codes));
    document.insert("table".to_owned(), JsonValue::Object(table));
    document.insert("memberRows".to_owned(), JsonValue::Object(member_rows));

    JsonValue::Object(document)
}

fn cell_json(cell: &DiffCell) -> JsonValue {
    match cell {
        DiffCell::Plain(plain) => JsonValue::String(plain.as_str().to_owned()),
        DiffCell::Conditional {
            when,
            holds,
            otherwise,
        } => {
            let mut object = JsonObject::new();

            object.insert(
                "when".to_owned(),
                JsonValue::String(when.as_str().to_owned()),
            );
            object.insert("holds".to_owned(), cell_json(holds));
            object.insert("otherwise".to_owned(), cell_json(otherwise));

            JsonValue::Object(object)
        }
    }
}

fn member_row_json(row: &MemberRow) -> JsonValue {
    match row {
        MemberRow::Kind(kind) => JsonValue::String(kind.as_str().to_owned()),
        MemberRow::Fixed { kind, case_name } => {
            let mut object = JsonObject::new();

            object.insert(
                "kind".to_owned(),
                JsonValue::String(kind.as_str().to_owned()),
            );
            object.insert(
                "case".to_owned(),
                JsonValue::String((*case_name).to_owned()),
            );

            JsonValue::Object(object)
        }
    }
}
