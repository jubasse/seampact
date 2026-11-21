//! The `formats` catalogue: every declared wire format and the core `bare`, and the check of each payload against its templates.

use std::collections::HashSet;
use std::{iter, mem};

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, RelatedLocation, quote_text};
use seampact_ir::{
    Absent, Direction, EachTemplate, ErrorShape, FormatId, HeaderTemplate, IrMap,
    KnownMemberNameRef, KnownSchemaRef, KnownTemplateRef, Layer, MemberName, MetaFill, MetaMember,
    ObjectSchema, ObjectTemplate, ObjectTemplateMember, OperationId, Origin, PlainMemberName,
    Refinements, ResponseShape, ScalarType, ScalarTypeUse, Shape, Slot, SlotTemplate,
    SuccessShapes, Template, TypeUse, ValueSource, ValueSourceIn, WireFormat,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, stringify_json};
use seampact_pass_tree_shared::{
    tree_nodes_answered_use, tree_nodes_member, tree_nodes_origin_at, tree_nodes_schema,
};
use seampact_pipeline::{DraftOperation, PassError, pointer_below};
use seampact_templates::{template_slots, template_uses};

use crate::api::text_of;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::pass::TreeNodesScope;
use crate::templates::{TreeNodesTemplatePlace, TreeNodesTemplateSite, tree_nodes_template};

/// The id of the core `bare` format.
pub(crate) const TREE_NODES_BARE_FORMAT: &str = "bare";
/// The pointer of the core `bare` format (ADR 0004 section 6), the origin of which is a core declaration.
pub(crate) const TREE_NODES_BARE_POINTER: &str = "/formats/bare";
/// The success media of a format that writes none, and of the core `bare`.
pub(crate) const TREE_NODES_DEFAULT_MEDIA: &str = "application/json";
/// The origin of the core `bare` format.
pub(crate) fn tree_nodes_bare_origin() -> Origin {
    Origin {
        api: None,
        layer: Layer::Core,
        pointer: TREE_NODES_BARE_POINTER.to_owned(),
    }
}

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

impl ShapeName {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Item => "item",
            Self::Table => "table",
            Self::List => "list",
            Self::Page => "page",
        }
    }

    const fn place(self) -> TreeNodesTemplatePlace {
        match self {
            Self::Item => TreeNodesTemplatePlace::Item,
            Self::Table => TreeNodesTemplatePlace::Table,
            Self::List => TreeNodesTemplatePlace::List,
            Self::Page => TreeNodesTemplatePlace::Page,
        }
    }
}

/// The slot a shape's body writes when the format writes none.
fn default_body_slot(shape: ShapeName) -> Result<&'static str, InternalError> {
    DEFAULT_BODY_SLOT
        .iter()
        .find(|(name, _)| *name == shape)
        .map(|(_, body_slot)| *body_slot)
        .ok_or_else(|| {
            InternalError::new(format!(
                "no default body slot for the shape {}",
                shape.as_str()
            ))
        })
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

impl PayloadRule {
    const fn as_str(self) -> &'static str {
        match self {
            Self::FormatId => "format-id",
            Self::FormatMerge => "format-merge",
            Self::FormatEach => "format-each",
            Self::FormatMember => "format-member",
            Self::TemplateSlot => "template-slot",
        }
    }

    const fn rule(self) -> TreeNodesRule {
        match self {
            Self::FormatId => TreeNodesRule::FormatId,
            Self::FormatMerge => TreeNodesRule::FormatMerge,
            Self::FormatEach => TreeNodesRule::FormatEach,
            Self::FormatMember => TreeNodesRule::FormatMember,
            Self::TemplateSlot => TreeNodesRule::TemplateSlot,
        }
    }
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
        origin: tree_nodes_bare_origin(),
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

    let mut reader = FormatReader::new(scope, id, &pointer);
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
/// The templates of a mapping (`headers`, a style's `meta`), each named as written; `None` when one is refused.
pub(crate) fn tree_nodes_named_templates(
    owner: &str,
    place: TreeNodesTemplatePlace,
    named_templates: Option<&JsonValue>,
    pointer: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Vec<HeaderTemplate>>, PassError> {
    let Some(JsonValue::Object(named)) = named_templates else {
        return Ok(Some(Vec::new()));
    };
    let mut templates = Vec::with_capacity(named.len());
    let mut refused = false;

    for (name, written) in js_key_order(named.iter()) {
        let site = TreeNodesTemplateSite {
            place,
            owner: owner.to_owned(),
        };
        let value = tree_nodes_template(&site, written, &pointer_below(pointer, &[name]), scope)?;

        match value {
            Some(value) => templates.push(HeaderTemplate {
                name: name.clone(),
                value,
            }),
            None => refused = true,
        }
    }

    Ok((!refused).then_some(templates))
}

impl<'scope, 'draft, 'half, 'run> FormatReader<'scope, 'draft, 'half, 'run> {
    fn new(
        scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
        id: &str,
        pointer: &str,
    ) -> Self {
        Self {
            scope,
            pointer: pointer.to_owned(),
            owner: format!("the format {id}"),
        }
    }

    fn success(&mut self, written: Option<&JsonValue>) -> Result<Option<SuccessShapes>, PassError> {
        let mut shapes: Vec<Option<Shape>> = Vec::with_capacity(SHAPES.len());

        for name in SHAPES {
            shapes.push(self.shape(*name, tree_nodes_member(written, name.as_str()))?);
        }

        let [Some(item), Some(table), Some(list), Some(page)] =
            <[Option<Shape>; 4]>::try_from(shapes).map_err(|_| {
                InternalError::new("a format does not read its four success shapes")
            })?
        else {
            return Ok(None);
        };

        Ok(Some(SuccessShapes {
            item,
            table,
            list,
            page,
        }))
    }

    fn shape(
        &mut self,
        name: ShapeName,
        written: Option<&JsonValue>,
    ) -> Result<Option<Shape>, PassError> {
        let pointer = pointer_below(&self.pointer, &["success", name.as_str()]);
        let written_body = tree_nodes_member(written, "body");
        let body = match written_body {
            None => Some(slot(default_body_slot(name)?)),
            Some(written_body) => tree_nodes_template(
                &self.site(name.place()),
                written_body,
                &format!("{pointer}/body"),
                self.scope,
            )?,
        };
        let headers = tree_nodes_named_templates(
            &self.owner,
            name.place(),
            tree_nodes_member(written, "headers"),
            &format!("{pointer}/headers"),
            self.scope,
        )?;

        Ok(body
            .zip(headers)
            .map(|(body, headers)| Shape { body, headers }))
    }

    fn meta(
        &mut self,
        written: Option<&JsonValue>,
    ) -> Result<Option<IndexMap<String, MetaMember>>, PassError> {
        let mut members = IndexMap::new();
        let Some(JsonValue::Object(written)) = written else {
            return Ok(Some(members));
        };
        let mut refused = false;

        for (name, field) in js_key_order(written.iter()) {
            match self.meta_member(name, field)? {
                Some(member) => {
                    members.insert(name.clone(), member);
                }
                None => refused = true,
            }
        }

        Ok((!refused).then_some(members))
    }

    // `now`, `traceId` and `degraded` have a core type; `handler` and a principal field take the written `schema`.
    fn meta_member(
        &mut self,
        name: &str,
        field: &JsonValue,
    ) -> Result<Option<MetaMember>, PassError> {
        let pointer = pointer_below(&self.pointer, &["meta", name]);
        let Some(fill) = text_of(tree_nodes_member(Some(field), "fill")) else {
            return Err(
                InternalError::new(format!("the meta field at {pointer} has no fill")).into(),
            );
        };
        let r#type = if tree_nodes_member(Some(field), "schema").is_none() {
            core_meta_type(fill)
        } else {
            Some(self.schema_type(&pointer)?)
        };
        let Some(r#type) = r#type else {
            self.refuse_untyped_meta(name, fill, &pointer)?;

            return Ok(None);
        };

        let Some(principal_name) = fill.strip_prefix(PRINCIPAL_PREFIX) else {
            let fill = if fill == HANDLER_FILL {
                MetaFill::Handler
            } else {
                meta_fill(fill)?
            };

            return Ok(Some(MetaMember {
                r#type,
                fill,
                source: None,
            }));
        };

        Ok(Some(MetaMember {
            r#type,
            fill: MetaFill::Source,
            source: Some(ValueSource {
                r#in: ValueSourceIn::Principal,
                name: Some(principal_name.to_owned()),
                prefix_bits: None,
            }),
        }))
    }

    fn schema_type(&self, pointer: &str) -> Result<TypeUse, PassError> {
        tree_nodes_answered_use(
            self.scope.schemas,
            &format!("{pointer}/schema"),
            &Direction::Output,
        )
    }

    fn refuse_untyped_meta(
        &mut self,
        name: &str,
        fill: &str,
        pointer: &str,
    ) -> Result<(), PassError> {
        let origin = tree_nodes_origin_at(self.scope.context, pointer)?;

        self.scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::FormatMeta,
                origin: tree_nodes_node_origin(&origin)?,
                message: format!(
                    "The meta field {} of {} is filled by {}, which gives it no type.",
                    quote_text(name),
                    self.owner,
                    quote_text(fill)
                ),
                fix: format!("Write the schema of {} beside its fill.", quote_text(name)),
                related: Vec::new(),
            }));

        Ok(())
    }

    // A format without `error` takes the bare one; its `media` defaults to the format's, and it must write `$code`.
    fn error(
        &mut self,
        written: Option<&JsonValue>,
        media: &str,
        bare_error: Option<&ErrorShape>,
    ) -> Result<Option<ErrorShape>, PassError> {
        let Some(written) = written else {
            return Ok(bare_error.cloned());
        };
        let pointer = pointer_below(&self.pointer, &["error"]);
        let written_body = tree_nodes_member(Some(written), "body");
        let body = match written_body {
            None => None,
            Some(written_body) => tree_nodes_template(
                &self.site(TreeNodesTemplatePlace::Error),
                written_body,
                &format!("{pointer}/body"),
                self.scope,
            )?,
        };
        let headers = tree_nodes_named_templates(
            &self.owner,
            TreeNodesTemplatePlace::Error,
            tree_nodes_member(Some(written), "headers"),
            &format!("{pointer}/headers"),
            self.scope,
        )?;

        if written_body.is_some() && body.is_none() {
            return Ok(None);
        }

        let Some(body) = body else {
            self.refuse_codeless(&pointer)?;

            return Ok(None);
        };

        if !template_uses(&body, "code")? && self.code_required()? {
            self.refuse_codeless(&pointer)?;

            return Ok(None);
        }

        let media = text_of(tree_nodes_member(Some(written), "media")).unwrap_or(media);

        Ok(headers.map(|headers| ErrorShape {
            media: media.to_owned(),
            body,
            headers,
        }))
    }

    // `conventions.errors.requireCode: false` lifts the refusal of an error body that writes no `$code`.
    fn code_required(&self) -> Result<bool, PassError> {
        let reading = self.scope.context.conventions.get("errors.requireCode")?;

        Ok(reading.map(|reading| reading.value) != Some(&JsonValue::Bool(false)))
    }

    fn refuse_codeless(&mut self, pointer: &str) -> Result<(), PassError> {
        let origin = tree_nodes_origin_at(self.scope.context, pointer)?;

        self.scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::FormatErrorCode,
                origin: tree_nodes_node_origin(&origin)?,
                message: format!(
                    "The error body of {} writes no $code, so a client cannot tell the error.",
                    self.owner
                ),
                fix: "Write $code in the error body, as a member or inside a text ('https://errors.example.com/${code}'), or set 'conventions.errors.requireCode: false'.".to_owned(),
                related: Vec::new(),
            }));

        Ok(())
    }

    fn site(&self, place: TreeNodesTemplatePlace) -> TreeNodesTemplateSite {
        TreeNodesTemplateSite {
            place,
            owner: self.owner.clone(),
        }
    }
}

/// The type a core meta fill gives its field.
fn core_meta_type(fill: &str) -> Option<TypeUse> {
    let (scalar_type, format) = match fill {
        "now" => (ScalarType::String, Some("date-time")),
        "traceId" => (ScalarType::String, None),
        "degraded" => (ScalarType::Boolean, None),
        _ => return None,
    };

    Some(TypeUse::Scalar(ScalarTypeUse {
        r#type: scalar_type,
        format: format.map(str::to_owned),
        scalar: None,
        refinements: Refinements::default(),
        content: None,
        sensitive: None,
        nullable: None,
        docs: None,
        examples: None,
    }))
}

fn meta_fill(fill: &str) -> Result<MetaFill, PassError> {
    METAFILLS
        .iter()
        .find(|candidate| candidate.as_str() == fill)
        .cloned()
        .ok_or_else(|| {
            let known: Vec<&str> = METAFILLS.iter().map(MetaFill::as_str).collect();

            InternalError::new(format!(
                "the meta fill {fill} is none of {}",
                known.join(", ")
            ))
            .into()
        })
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

            for written in written_templates(operation, format, shape, scope) {
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
    type_use: &TypeUse,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<SlotValue, PassError> {
    if let TypeUse::Array(array) = type_use {
        return Ok(SlotValue::Array {
            items: (*array.items).clone(),
        });
    }

    let schema = match type_use {
        TypeUse::Ref(reference) => tree_nodes_schema(scope.draft, reference.schema.as_str()),
        _ => None,
    };
    let Some(schema) = schema else {
        return Ok(SlotValue::Other);
    };

    Ok(match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => SlotValue::Object {
            schema: object.clone(),
        },
        KnownSchemaRef::Map(_) => SlotValue::Table,
        KnownSchemaRef::Union(_) => SlotValue::Other,
    })
}

// `$payload` is the item, the id-keyed table, or the records of a list or page.
fn payload_of(
    shape: ShapeName,
    body: &TypeUse,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<SlotValue, PassError> {
    match shape {
        ShapeName::Item => slot_value_of_use(body, scope),
        ShapeName::Table => Ok(SlotValue::Table),
        ShapeName::List | ShapeName::Page => Ok(SlotValue::Array {
            items: record_of(shape, body),
        }),
    }
}

fn record_of(shape: ShapeName, body: &TypeUse) -> TypeUse {
    match body {
        TypeUse::Array(array) if matches!(shape, ShapeName::List | ShapeName::Page) => {
            (*array.items).clone()
        }
        _ => body.clone(),
    }
}
fn shape_in(success: &SuccessShapes, shape: ShapeName) -> &Shape {
    match shape {
        ShapeName::Item => &success.item,
        ShapeName::Table => &success.table,
        ShapeName::List => &success.list,
        ShapeName::Page => &success.page,
    }
}

fn written_templates(
    operation: &DraftOperation,
    format: &WireFormat,
    shape: ShapeName,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Vec<WrittenTemplate> {
    let format_owner = TemplateOwner {
        name: format!("the format {}", format.id.as_str()),
        origin: format.origin.clone(),
    };
    let success = shape_in(&format.success, shape);
    let format_headers = success.headers.iter().map(|header| WrittenTemplate {
        template: header.value.clone(),
        owner: format_owner.clone(),
    });
    let style_id = operation
        .paging
        .as_ref()
        .and_then(|paging| paging.style.as_ref());
    let style = match style_id {
        Some(id) if shape == ShapeName::Page => scope.output.pagings.get(id),
        _ => None,
    };
    let body = WrittenTemplate {
        template: success.body.clone(),
        owner: format_owner.clone(),
    };
    let Some(style) = style else {
        return iter::once(body).chain(format_headers).collect();
    };
    let style_owner = TemplateOwner {
        name: format!("the paging style {}", style.id.as_str()),
        origin: style.origin.clone(),
    };
    let response = &style.response;
    let first = match &response.body {
        Some(template) => WrittenTemplate {
            template: template.clone(),
            owner: style_owner.clone(),
        },
        None => body,
    };
    let style_templates = response
        .meta
        .iter()
        .map(|member| &member.value)
        .chain(response.headers.iter().map(|header| &header.value))
        .map(|template| WrittenTemplate {
            template: template.clone(),
            owner: style_owner.clone(),
        });

    iter::once(first)
        .chain(format_headers)
        .chain(style_templates)
        .collect()
}

pub(crate) fn operation_id_of(operation: &DraftOperation) -> Result<&str, InternalError> {
    operation
        .id
        .as_ref()
        .map(OperationId::as_str)
        .ok_or_else(|| InternalError::new("an operation has no id"))
}

fn check_id_slots(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation = check.operation;
    let used = template_slots(&written.template)?
        .into_iter()
        .find(|used| ID_SLOTS.contains(&used.slot.as_str()));
    let Some(used) = used else {
        return Ok(());
    };
    let property = operation.resource.as_ref().and_then(|resource| {
        resource
            .id_property
            .as_deref()
            .or(resource.id_param.as_deref())
    });
    let item = slot_value_of_use(&check.record, scope)?;

    if let (Some(property), SlotValue::Object { schema }) = (property, &item)
        && has_property(schema, property)
    {
        return Ok(());
    }

    let named = property.map_or_else(String::new, |property| format!(" {}", quote_text(property)));
    let to_declare = property.map_or_else(|| "the id property".to_owned(), quote_text);

    report_payload(
        check,
        &written.owner,
        &PayloadFault {
            rule: PayloadRule::FormatId,
            message: format!(
                "The template of {} writes ${}, but the item of {} has no id property{named}.",
                written.owner.name,
                used.slot,
                operation_id_of(operation)?
            ),
            fix: format!(
                "Declare {to_declare} on the item (or set idProperty), or use a format that reads no id."
            ),
        },
        scope,
    )
}

// `$collection` in an item names the collection or single the operation belongs to; outside one it has no value.
fn check_item_collection_slot(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation = check.operation;

    if check.shape != ShapeName::Item || operation.resource.is_some() {
        return Ok(());
    }

    let uses_collection = template_slots(&written.template)?
        .iter()
        .any(|used| used.slot == COLLECTION_SLOT);

    if !uses_collection {
        return Ok(());
    }

    report_payload(
        check,
        &written.owner,
        &PayloadFault {
            rule: PayloadRule::TemplateSlot,
            message: format!(
                "The template of {} writes ${COLLECTION_SLOT} in an item, but {} belongs to no collection or single.",
                written.owner.name,
                operation_id_of(operation)?
            ),
            fix: "Set format: bare (or another format) on the route, or move it under a collection or single."
                .to_owned(),
        },
        scope,
    )
}

// A member name written twice in one object would be one member in the document: `$collection` names a member by
// the resource type the operation fixes, so a literal member of that name collides with it.
fn check_member_names(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let resource_type = check
        .operation
        .resource
        .as_ref()
        .map(|resource| resource.r#type.as_str());
    let Some(duplicate) = duplicate_member_name(&written.template, resource_type)? else {
        return Ok(());
    };

    report_payload(
        check,
        &written.owner,
        &PayloadFault {
            rule: PayloadRule::FormatMember,
            message: format!(
                "The template of {} writes the member {} twice in {}.",
                written.owner.name,
                quote_text(&duplicate),
                operation_id_of(check.operation)?
            ),
            fix: "Rename one of the members, or stop naming a member with $collection where a literal member has the resource's name."
                .to_owned(),
        },
        scope,
    )
}

fn duplicate_member_name(
    template: &Template,
    resource_type: Option<&str>,
) -> Result<Option<String>, PassError> {
    match KnownTemplateRef::try_from(template)? {
        KnownTemplateRef::Object(object) => {
            let mut seen = HashSet::new();

            for member in &object.members {
                let Some(name) = member_name_text(&member.name, resource_type)? else {
                    continue;
                };

                if seen.contains(&name) {
                    return Ok(Some(name));
                }

                seen.insert(name);
            }

            for member in &object.members {
                if let Some(nested) = duplicate_member_name(&member.value, resource_type)? {
                    return Ok(Some(nested));
                }
            }

            Ok(None)
        }
        KnownTemplateRef::Array(array) => {
            for item in &array.items {
                if let Some(name) = duplicate_member_name(item, resource_type)? {
                    return Ok(Some(name));
                }
            }

            Ok(None)
        }
        KnownTemplateRef::Each(each) => duplicate_member_name(&each.r#as, resource_type),
        KnownTemplateRef::Slot(_) | KnownTemplateRef::Text(_) | KnownTemplateRef::Literal(_) => {
            Ok(None)
        }
    }
}

fn member_name_text(
    name: &MemberName,
    resource_type: Option<&str>,
) -> Result<Option<String>, PassError> {
    Ok(match KnownMemberNameRef::try_from(name)? {
        KnownMemberNameRef::Text(text) => Some(text.text.clone()),
        KnownMemberNameRef::Slot(named) if named.slot.as_str() == COLLECTION_SLOT => {
            resource_type.map(str::to_owned)
        }
        KnownMemberNameRef::Slot(_) => None,
    })
}

fn has_property(schema: &ObjectSchema, name: &str) -> bool {
    schema
        .properties
        .iter()
        .any(|property| property.name == name)
}

// Walks a template with the element `$item` holds inside `$as`.
fn check_slot_values(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    template: &Template,
    element: Option<&SlotValue>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    match KnownTemplateRef::try_from(template)? {
        KnownTemplateRef::Object(object) => {
            if let Some(merge) = &object.merge {
                check_merge(check, written, object, merge.as_str(), element, scope)?;
            }

            for member in &object.members {
                check_slot_values(check, written, &member.value, element, scope)?;
            }

            Ok(())
        }
        KnownTemplateRef::Array(array) => {
            for item in &array.items {
                check_slot_values(check, written, item, element, scope)?;
            }

            Ok(())
        }
        KnownTemplateRef::Each(each) => {
            let inner = each_element(check, written, each, element, scope)?;

            check_slot_values(check, written, &each.r#as, inner.as_ref(), scope)
        }
        KnownTemplateRef::Slot(_) | KnownTemplateRef::Text(_) | KnownTemplateRef::Literal(_) => {
            Ok(())
        }
    }
}

// The value a slot holds for this response; `None` for an object slot the payload does not set (`$meta`).
fn slot_value(
    check: &PayloadCheck<'_>,
    slot_name: &str,
    element: Option<&SlotValue>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<SlotValue>, PassError> {
    match slot_name {
        "payload" => Ok(Some(check.payload.clone())),
        "items" => Ok(Some(SlotValue::Array {
            items: check.record.clone(),
        })),
        "fields" => Ok(Some(slot_value_of_use(&check.record, scope)?)),
        "item" | "itemFields" => Ok(element.cloned()),
        _ => Ok(None),
    }
}

fn each_element(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    template: &EachTemplate,
    element: Option<&SlotValue>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<SlotValue>, PassError> {
    let of = template.of.as_str();
    let Some(mapped) = slot_value(check, of, element, scope)? else {
        return Ok(None);
    };

    if let SlotValue::Array { items } = &mapped {
        return Ok(Some(slot_value_of_use(items, scope)?));
    }

    report_payload(
        check,
        &written.owner,
        &PayloadFault {
            rule: PayloadRule::FormatEach,
            message: format!(
                "The template of {} maps ${of} with $each, but it holds no array for {}.",
                written.owner.name,
                operation_id_of(check.operation)?
            ),
            fix: format!(
                "Write ${of} as a member, or use a format whose {} shape maps no ${of}.",
                check.shape.as_str()
            ),
        },
        scope,
    )?;

    Ok(None)
}

// A table's id-keyed payload is an object whose members are ids, so no member clash is checked.
fn check_merge(
    check: &PayloadCheck<'_>,
    written: &WrittenTemplate,
    template: &ObjectTemplate,
    merge: &str,
    element: Option<&SlotValue>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation = check.operation;
    let owner = &written.owner;
    let merged = slot_value(check, merge, element, scope)?;

    let schema = match &merged {
        None | Some(SlotValue::Table) => return Ok(()),
        Some(SlotValue::Object { schema }) => schema,
        Some(other) => {
            let holds = if matches!(other, SlotValue::Array { .. }) {
                "an array"
            } else {
                "no object"
            };
            let operation_id = operation_id_of(operation)?;

            return report_payload(
                check,
                owner,
                &PayloadFault {
                    rule: PayloadRule::FormatMerge,
                    message: format!(
                        "The template of {} merges ${merge}, but it holds {holds} for {operation_id}.",
                        owner.name
                    ),
                    fix: format!(
                        "Answer an object from {operation_id}, map an array with {{ $each: ${merge}, $as: <template> }}, or use a format that wraps the payload."
                    ),
                },
                scope,
            );
        }
    };
    let id_property = if IDLESS_SLOTS.contains(&merge) {
        operation.resource.as_ref().and_then(|resource| {
            resource
                .id_property
                .as_deref()
                .or(resource.id_param.as_deref())
        })
    } else {
        None
    };
    let member_names: Vec<&str> = template
        .members
        .iter()
        .map(|member| KnownMemberNameRef::try_from(&member.name))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter_map(|name| match name {
            KnownMemberNameRef::Text(text) => Some(text.text.as_str()),
            KnownMemberNameRef::Slot(_) => None,
        })
        .collect();
    let twice = schema.properties.iter().find(|property| {
        Some(property.name.as_str()) != id_property
            && member_names.contains(&property.name.as_str())
    });
    let Some(twice) = twice else {
        return Ok(());
    };

    report_payload(
        check,
        owner,
        &PayloadFault {
            rule: PayloadRule::FormatMerge,
            message: format!(
                "The template of {} writes the member {}, which the merged ${merge} of {} defines too.",
                owner.name,
                quote_text(&twice.name),
                operation_id_of(operation)?
            ),
            fix: format!(
                "Rename the property {} of {}, or the template's member.",
                quote_text(&twice.name),
                schema.id.as_str()
            ),
        },
        scope,
    )
}

// Two success responses of one operation may share a fault: it is reported once.
fn report_payload(
    check: &PayloadCheck<'_>,
    owner: &TemplateOwner,
    fault: &PayloadFault,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let operation = check.operation;
    let key = stringify_json(&JsonValue::Array(vec![
        JsonValue::String(fault.rule.as_str().to_owned()),
        JsonValue::String(operation_id_of(operation)?.to_owned()),
        JsonValue::String(fault.message.clone()),
    ]));
    let related = if owner.origin.layer == Layer::Core {
        Vec::new()
    } else {
        vec![RelatedLocation {
            origin: tree_nodes_node_origin(&owner.origin)?,
            message: owner.name.clone(),
        }]
    };
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: fault.rule.rule(),
        origin: tree_nodes_node_origin(&origin_of_operation(operation)?)?,
        message: fault.message.clone(),
        fix: fault.fix.clone(),
        related,
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(())
}

fn origin_of_operation(operation: &DraftOperation) -> Result<Origin, PassError> {
    operation.origin.clone().ok_or_else(|| {
        InternalError::new(format!(
            "the operation {} has no origin",
            operation
                .id
                .as_ref()
                .map_or("undefined", OperationId::as_str)
        ))
        .into()
    })
}
