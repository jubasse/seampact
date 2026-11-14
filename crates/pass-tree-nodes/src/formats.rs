//! The `formats` catalogue: every declared wire format and the core `bare`, and the check of each payload against its templates.

use indexmap::IndexMap;
use seampact_ir::{
    Absent, EachTemplate, ErrorShape, HeaderTemplate, MemberName, MetaFill, MetaMember,
    ObjectSchema, ObjectTemplate, ObjectTemplateMember, Origin, ResponseShape, Shape,
    SuccessShapes, Template, TypeUse, WireFormat,
};
use seampact_json::JsonValue;
use seampact_pipeline::{DraftOperation, PassError};

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

fn slot(_name: &str) -> Result<Template, PassError> {
    Err(not_ported_yet("slot"))
}

fn bare_error_member(
    _name: &str,
    _slot_name: Option<&str>,
) -> Result<ObjectTemplateMember, PassError> {
    Err(not_ported_yet("bareErrorMember"))
}

pub(crate) fn tree_nodes_formats(_scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesFormats"))
}

fn declared_format<'run>(
    _id: &str,
    _scope: &TreeNodesScope<'_, '_, 'run>,
) -> Result<Option<&'run JsonValue>, PassError> {
    Err(not_ported_yet("declaredFormat"))
}

fn core_bare(_scope: &TreeNodesScope<'_, '_, '_>) -> Result<WireFormat, PassError> {
    Err(not_ported_yet("coreBare"))
}

fn format_of(
    _id: &str,
    _bare_error: Option<&ErrorShape>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<WireFormat>, PassError> {
    Err(not_ported_yet("formatOf"))
}

pub(crate) fn tree_nodes_absent(_written: Option<&JsonValue>) -> Result<Absent, PassError> {
    Err(not_ported_yet("treeNodesAbsent"))
}

fn text_of(_value: Option<&JsonValue>) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("textOf"))
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

pub(crate) fn tree_nodes_check_payloads(
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckPayloads"))
}

fn own_of<'catalogue, Value>(
    _catalogue: &'catalogue IndexMap<String, Value>,
    _id: &str,
) -> Result<Option<&'catalogue Value>, PassError> {
    Err(not_ported_yet("ownOf"))
}

fn is_success_shape(_shape: &ResponseShape) -> Result<bool, PassError> {
    Err(not_ported_yet("isSuccessShape"))
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

fn record_of(_shape: ShapeName, _body: &TypeUse) -> Result<TypeUse, PassError> {
    Err(not_ported_yet("recordOf"))
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
