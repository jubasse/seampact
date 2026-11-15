//! The `formats` catalogue: every declared wire format and the core `bare`, and the check of each payload against its templates.

use std::mem;

use indexmap::IndexMap;
use seampact_ir::{
    Absent, EachTemplate, ErrorShape, FormatId, HeaderTemplate, IrMap, Layer, MemberName, MetaFill,
    MetaMember, ObjectSchema, ObjectTemplate, ObjectTemplateMember, Origin, PlainMemberName,
    ResponseShape, Shape, Slot, SlotTemplate, SuccessShapes, Template, TypeUse, WireFormat,
};
use seampact_js::js_key_order;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_member;
use seampact_pipeline::{DraftOperation, PassError, pointer_below};

use crate::api::text_of;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;
use crate::templates::{TreeNodesTemplatePlace, TreeNodesTemplateSite};

/// The id of the core `bare` format.
pub(crate) const TREE_NODES_BARE_FORMAT: &str = "bare";
/// The pointer of the core `bare` format (ADR 0004 section 6), the origin of which is a core declaration.
pub(crate) const TREE_NODES_BARE_POINTER: &str = "/formats/bare";
/// The success media of a format that writes none, and of the core `bare`.
pub(crate) const TREE_NODES_DEFAULT_MEDIA: &str = "application/json";
const BARE_ERROR_MEDIA: &str = "application/problem+json";
const NULL_ABSENT: Absent = Absent::Null;
const DEFAULT_ABSENT: Absent = Absent::Omit;
/// The slot the bare error spreads the error's params into.
const PARAMS_SLOT: &str = "params";
/// The slots of the bare error, each the member of the same name but `type`, which holds the code.
const BARE_ERROR_MEMBERS: &[(&str, &str)] = &[
    ("type", "code"),
    ("title", "title"),
    ("status", "status"),
    ("detail", "detail"),
    ("instance", "instance"),
    ("code", "code"),
    ("nature", "nature"),
    ("traceId", "traceId"),
];
/// A shape left out writes the payload (the page's records for `page`) and no header.
const DEFAULT_BODY_SLOT: &[(ShapeName, &str)] = &[
    (ShapeName::Item, "payload"),
    (ShapeName::Table, "payload"),
    (ShapeName::List, "payload"),
    (ShapeName::Page, "items"),
];
const HANDLER_FILL: &str = "handler";
const PRINCIPAL_PREFIX: &str = "principal.";
/// The slots that read the item's id property. `$self` is not one: it is the member URL when the item has the
/// id property, the request URL otherwise.
const ID_SLOTS: &[&str] = &["id", "fields", "itemId", "itemFields", "itemSelf"];
const COLLECTION_SLOT: &str = "collection";
/// The slots that hold the record without its id member.
const IDLESS_SLOTS: &[&str] = &["fields", "itemFields"];
const METAFILLS: &[MetaFill] = &[MetaFill::Now, MetaFill::TraceId, MetaFill::Degraded];

/// The success shapes of a format, by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShapeName {
    Item,
    Table,
    List,
    Page,
}

const SHAPES: &[ShapeName] = &[
    ShapeName::Item,
    ShapeName::Table,
    ShapeName::List,
    ShapeName::Page,
];

/// The format or paging style a template belongs to, as messages name it.
#[derive(Debug, Clone, PartialEq)]
struct TemplateOwner {
    name: String,
    origin: Origin,
}

/// A template an operation's response really writes, with its owner.
#[derive(Debug, Clone, PartialEq)]
struct WrittenTemplate {
    template: Template,
    owner: TemplateOwner,
}

/// What a slot holds for a payload check.
#[derive(Debug, Clone, PartialEq)]
enum SlotValue {
    Object { schema: ObjectSchema },
    Table,
    Array { items: TypeUse },
    Other,
}

/// One payload under check: the operation, its shape and what the payload slot holds.
#[derive(Debug, Clone)]
struct PayloadCheck<'operation> {
    operation: &'operation DraftOperation,
    shape: ShapeName,
    payload: SlotValue,
    /// The use of one record: the item, or an element of the list or page.
    record: TypeUse,
}

/// The rules a payload check reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PayloadRule {
    FormatId,
    FormatMerge,
    FormatEach,
    FormatMember,
    TemplateSlot,
}

/// A payload fault with how to fix it.
#[derive(Debug, Clone)]
struct PayloadFault {
    rule: PayloadRule,
    message: String,
    fix: String,
}

/// Reads one wire format from the merged raw tree and reports what it refuses.
pub(crate) struct FormatReader<'scope, 'draft, 'half, 'run> {
    pub(crate) scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
    pub(crate) id: String,
    pub(crate) pointer: String,
    pub(crate) owner: String,
}

fn slot(name: &str) -> Template {
    Template::Slot(SlotTemplate {
        slot: Slot::new(name.to_owned()),
        path: Vec::new(),
    })
}
fn bare_error_member(name: &str, slot_name: &str) -> ObjectTemplateMember {
    ObjectTemplateMember {
        name: MemberName::Text(PlainMemberName {
            text: name.to_owned(),
        }),
        value: slot(slot_name),
    }
}

// The RFC 9457 members of the bare error, its params spread beside them.
fn bare_error() -> ErrorShape {
    ErrorShape {
        media: BARE_ERROR_MEDIA.to_owned(),
        body: Template::Object(ObjectTemplate {
            members: BARE_ERROR_MEMBERS
                .iter()
                .map(|(name, slot_name)| bare_error_member(name, slot_name))
                .collect(),
            merge: Some(Slot::new(PARAMS_SLOT.to_owned())),
        }),
        headers: Vec::new(),
    }
}
/// Writes `formats`: every declared format, used or not, and `bare`, from the core where no layer declares it.
pub(crate) fn tree_nodes_formats(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    // A declared `bare` is read first, since a format without `error` takes its error.
    let bare = format_of(TREE_NODES_BARE_FORMAT, Some(&bare_error()), scope)?;
    let bare_error = bare.as_ref().map(|bare| bare.error.clone());

    if let Some(bare) = bare {
        scope
            .output
            .formats
            .insert(FormatId::new(TREE_NODES_BARE_FORMAT.to_owned()), bare);
    }

    let declared = scope.context.raw.merged.get("formats");
    let Some(JsonValue::Object(declared)) = declared else {
        return Ok(());
    };

    for (id, _) in js_key_order(declared.iter()) {
        if id == TREE_NODES_BARE_FORMAT {
            continue;
        }

        if let Some(format) = format_of(id, bare_error.as_ref(), scope)? {
            scope
                .output
                .formats
                .insert(FormatId::new(id.clone()), format);
        }
    }

    Ok(())
}
fn declared_format<'run>(
    id: &str,
    scope: &TreeNodesScope<'_, '_, 'run>,
) -> Option<&'run JsonValue> {
    tree_nodes_member(scope.context.raw.merged.get("formats"), id)
}
fn core_bare() -> WireFormat {
    let shape = |body: &str| Shape {
        body: slot(body),
        headers: Vec::new(),
    };

    WireFormat {
        id: FormatId::new(TREE_NODES_BARE_FORMAT.to_owned()),
        origin: Origin {
            api: None,
            layer: Layer::Core,
            pointer: TREE_NODES_BARE_POINTER.to_owned(),
        },
        media: TREE_NODES_DEFAULT_MEDIA.to_owned(),
        absent: DEFAULT_ABSENT,
        success: SuccessShapes {
            item: shape("payload"),
            table: shape("payload"),
            list: shape("payload"),
            page: shape("items"),
        },
        meta: IrMap::new(),
        error: bare_error(),
    }
}
/// Reads a declared format; absent when it is refused (reported) or declared nowhere (`format-unknown`).
fn format_of(
    id: &str,
    bare_error: Option<&ErrorShape>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<WireFormat>, PassError> {
    let pointer = pointer_below("/formats", &[id]);
    let declared = declared_format(id, scope);
    let origin = scope.context.origin(&pointer);

    let (Some(declared), Some(origin)) = (declared, origin) else {
        return Ok((id == TREE_NODES_BARE_FORMAT).then(core_bare));
    };

    let mut reader = FormatReader::new(scope, id, &pointer)?;
    let media =
        text_of(tree_nodes_member(Some(declared), "media")).unwrap_or(TREE_NODES_DEFAULT_MEDIA);
    let success = reader.success(tree_nodes_member(Some(declared), "success"))?;
    let meta = reader.meta(tree_nodes_member(Some(declared), "meta"))?;
    let error = reader.error(
        tree_nodes_member(Some(declared), "error"),
        media,
        bare_error,
    )?;

    let (Some(success), Some(meta), Some(error)) = (success, meta, error) else {
        return Ok(None);
    };

    Ok(Some(WireFormat {
        id: FormatId::new(id.to_owned()),
        origin,
        media: media.to_owned(),
        absent: tree_nodes_absent(tree_nodes_member(Some(declared), "absent")),
        success,
        meta: meta.into_iter().collect(),
        error,
    }))
}
/// What a slot with no value writes: `null` when `absent` is written null, else omitted.
pub(crate) fn tree_nodes_absent(written: Option<&JsonValue>) -> Absent {
    match written {
        Some(JsonValue::Null) => NULL_ABSENT,
        _ => DEFAULT_ABSENT,
    }
}
pub(crate) fn tree_nodes_named_templates(
    _owner: &str,
    _place: TreeNodesTemplatePlace,
    _named_templates: Option<&JsonValue>,
    _pointer: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Vec<HeaderTemplate>>, PassError> {
    Err(not_ported_yet("treeNodesNamedTemplates"))
}

#[allow(
    clippy::unused_self,
    reason = "stubs read nothing until the half's last brief"
)]
impl<'scope, 'draft, 'half, 'run> FormatReader<'scope, 'draft, 'half, 'run> {
    fn new(
        _scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
        _id: &str,
        _pointer: &str,
    ) -> Result<Self, PassError> {
        Err(not_ported_yet("FormatReader.constructor"))
    }

    fn success(
        &mut self,
        _written: Option<&JsonValue>,
    ) -> Result<Option<SuccessShapes>, PassError> {
        Err(not_ported_yet("FormatReader.success"))
    }

    fn shape(
        &mut self,
        _name: ShapeName,
        _written: Option<&JsonValue>,
    ) -> Result<Option<Shape>, PassError> {
        Err(not_ported_yet("FormatReader.shape"))
    }

    fn meta(
        &mut self,
        _written: Option<&JsonValue>,
    ) -> Result<Option<IndexMap<String, MetaMember>>, PassError> {
        Err(not_ported_yet("FormatReader.meta"))
    }

    fn meta_member(
        &mut self,
        _name: &str,
        _field: &JsonValue,
    ) -> Result<Option<MetaMember>, PassError> {
        Err(not_ported_yet("FormatReader.metaMember"))
    }

    fn schema_type(&self, _pointer: &str) -> Result<TypeUse, PassError> {
        Err(not_ported_yet("FormatReader.schemaType"))
    }

    fn refuse_untyped_meta(
        &mut self,
        _name: &str,
        _fill: &str,
        _pointer: &str,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("FormatReader.refuseUntypedMeta"))
    }

    fn error(
        &mut self,
        _written: Option<&JsonValue>,
        _media: &str,
        _bare_error: Option<&ErrorShape>,
    ) -> Result<Option<ErrorShape>, PassError> {
        Err(not_ported_yet("FormatReader.error"))
    }

    fn code_required(&self) -> Result<bool, PassError> {
        Err(not_ported_yet("FormatReader.codeRequired"))
    }

    fn refuse_codeless(&mut self, _pointer: &str) -> Result<(), PassError> {
        Err(not_ported_yet("FormatReader.refuseCodeless"))
    }

    fn site(&self, _place: TreeNodesTemplatePlace) -> Result<TreeNodesTemplateSite, PassError> {
        Err(not_ported_yet("FormatReader.site"))
    }
}

fn meta_fill(_fill: &str) -> Result<MetaFill, PassError> {
    Err(not_ported_yet("metaFill"))
}

/// Checks each success response of each operation against the templates its format and paging style write.
pub(crate) fn tree_nodes_check_payloads(
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operations = mem::take(&mut scope.output.operations);
    let formats = mem::take(&mut scope.output.formats);

    for operation in &operations {
        let Some(format) = operation
            .format
            .as_ref()
            .and_then(|id| own_of(&formats, id))
        else {
            continue;
        };

        for response in operation.responses.iter().flatten() {
            let Some(body) = &response.body else {
                continue;
            };
            let Some(shape) = success_shape_of(&response.shape) else {
                continue;
            };

            let check = PayloadCheck {
                operation,
                shape,
                payload: payload_of(shape, body, scope)?,
                record: record_of(shape, body),
            };

            for written in written_templates(operation, format, shape, scope)? {
                check_id_slots(&check, &written, scope)?;
                check_item_collection_slot(&check, &written, scope)?;
                check_member_names(&check, &written, scope)?;
                check_slot_values(&check, &written, &written.template, None, scope)?;
            }
        }
    }

    scope.output.operations = operations;
    scope.output.formats = formats;

    Ok(())
}
fn own_of<'catalogue, Value>(
    catalogue: &'catalogue IrMap<FormatId, Value>,
    id: &FormatId,
) -> Option<&'catalogue Value> {
    catalogue.get(id)
}
fn success_shape_of(shape: &ResponseShape) -> Option<ShapeName> {
    match shape {
        ResponseShape::Item => Some(ShapeName::Item),
        ResponseShape::Table => Some(ShapeName::Table),
        ResponseShape::List => Some(ShapeName::List),
        ResponseShape::Page => Some(ShapeName::Page),
        _ => None,
    }
}
fn slot_value_of_use(
    _type_use: &TypeUse,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<SlotValue, PassError> {
    Err(not_ported_yet("slotValueOfUse"))
}

fn payload_of(
    _shape: ShapeName,
    _body: &TypeUse,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<SlotValue, PassError> {
    Err(not_ported_yet("payloadOf"))
}

fn record_of(shape: ShapeName, body: &TypeUse) -> TypeUse {
    match body {
        TypeUse::Array(array) if matches!(shape, ShapeName::List | ShapeName::Page) => {
            (*array.items).clone()
        }
        _ => body.clone(),
    }
}
fn written_templates(
    _operation: &DraftOperation,
    _format: &WireFormat,
    _shape: ShapeName,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<WrittenTemplate>, PassError> {
    Err(not_ported_yet("writtenTemplates"))
}

fn check_id_slots(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkIdSlots"))
}

fn check_item_collection_slot(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkItemCollectionSlot"))
}

fn check_member_names(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkMemberNames"))
}

fn duplicate_member_name(
    _template: &Template,
    _resource_type: Option<&str>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("duplicateMemberName"))
}

fn member_name_text(
    _name: &MemberName,
    _resource_type: Option<&str>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("memberNameText"))
}

fn has_property(_schema: &ObjectSchema, _name: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("hasProperty"))
}

fn check_slot_values(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _template: &Template,
    _element: Option<&SlotValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkSlotValues"))
}

fn slot_value(
    _check: &PayloadCheck<'_>,
    _slot_name: &str,
    _element: Option<&SlotValue>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<SlotValue>, PassError> {
    Err(not_ported_yet("slotValue"))
}

fn each_element(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _template: &EachTemplate,
    _element: Option<&SlotValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<SlotValue>, PassError> {
    Err(not_ported_yet("eachElement"))
}

fn check_merge(
    _check: &PayloadCheck<'_>,
    _written: &WrittenTemplate,
    _template: &ObjectTemplate,
    _merge: &str,
    _element: Option<&SlotValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkMerge"))
}

fn report_payload(
    _check: &PayloadCheck<'_>,
    _owner: &TemplateOwner,
    _fault: &PayloadFault,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportPayload"))
}

fn origin_of_operation(_operation: &DraftOperation) -> Result<Origin, PassError> {
    Err(not_ported_yet("originOfOperation"))
}
