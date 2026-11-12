//! Wire formats, paging styles and the templates they write.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    Absent, FormatId, HandlerResultMember, IrMap, MemberName, MetaFill, Origin, PagingId,
    PagingParamPlacement, PagingParamStyle, PagingPosition, PagingRole, Slot, Template, TextPart,
    TypeUse, UrlRole, ValueSource, integers,
};

/// The `HeaderTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderTemplate {
    /// The `name` member.
    pub name: String,

    /// The `value` member.
    pub value: Template,
}

/// The `Shape` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    /// The `body` member.
    pub body: Template,

    /// The `headers` member.
    pub headers: Vec<HeaderTemplate>,
}

/// The `SuccessShapes` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessShapes {
    /// The `item` member.
    pub item: Shape,

    /// The `table` member.
    pub table: Shape,

    /// The `list` member.
    pub list: Shape,

    /// The `page` member.
    pub page: Shape,
}

/// A member of the format's $meta: 'source' set if and only if 'fill' is 'source' (invariant ir.meta.source).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaMember {
    /// The `type` member.
    pub r#type: TypeUse,

    /// The `fill` member.
    pub fill: MetaFill,

    /// The `source` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ValueSource>,
}

/// The `ErrorShape` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorShape {
    /// The `media` member.
    pub media: String,

    /// The `body` member.
    pub body: Template,

    /// The `headers` member.
    pub headers: Vec<HeaderTemplate>,
}

/// A wire format (A30, ADR 0008).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireFormat {
    /// The `id` member.
    pub id: FormatId,

    /// The `origin` member.
    pub origin: Origin,

    /// The `media` member.
    pub media: String,

    /// The `absent` member.
    pub absent: Absent,

    /// The `success` member.
    pub success: SuccessShapes,

    /// The `meta` member.
    pub meta: IrMap<String, MetaMember>,

    /// The `error` member.
    pub error: ErrorShape,
}

/// The `PagingRequestRole` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagingRequestRole {
    /// The `role` member.
    pub role: PagingRole,

    /// The `in` member.
    pub r#in: PagingParamPlacement,

    /// The `name` member.
    pub name: String,

    /// The `base` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_paging_base",
        skip_serializing_if = "Option::is_none"
    )]
    pub base: Option<i64>,

    /// The `style` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<PagingParamStyle>,

    /// With style 'split': the direction parameter's name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
}

/// The `NamedTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedTemplate {
    /// The `name` member.
    pub name: String,

    /// The `value` member.
    pub value: Template,
}

/// The `PagingLink` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagingLink {
    /// The `rel` member.
    pub rel: String,

    /// The `role` member.
    pub role: UrlRole,
}

/// The `PagingResponse` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagingResponse {
    /// The whole page body; absent when the style adds 'meta' to the format's page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Template>,

    /// The `meta` member.
    pub meta: Vec<NamedTemplate>,

    /// The `headers` member.
    pub headers: Vec<HeaderTemplate>,

    /// The `links` member.
    pub links: Vec<PagingLink>,
}

/// A paging style (A31).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagingStyle {
    /// The `id` member.
    pub id: PagingId,

    /// The `origin` member.
    pub origin: Origin,

    /// The `position` member.
    pub position: PagingPosition,

    /// The `absent` member.
    pub absent: Absent,

    /// The `request` member.
    pub request: Vec<PagingRequestRole>,

    /// The `response` member.
    pub response: PagingResponse,

    /// The `handlerResult` member.
    pub handler_result: Vec<HandlerResultMember>,
}

/// The `SlotTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotTemplate {
    /// The `slot` member.
    pub slot: Slot,

    /// The `path` member.
    pub path: Vec<String>,
}

/// The `PlainTextPart` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainTextPart {
    /// The `text` member.
    pub text: String,
}

/// The `SlotTextPart` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotTextPart {
    /// The `slot` member.
    pub slot: Slot,

    /// The `path` member.
    pub path: Vec<String>,
}

/// The `TextTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTemplate {
    /// The `parts` member.
    pub parts: Vec<TextPart>,
}

/// The `LiteralTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteralTemplate {
    /// The `value` member.
    pub value: JsonValue,
}

/// The `PlainMemberName` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainMemberName {
    /// The `text` member.
    pub text: String,
}

/// The `SlotMemberName` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotMemberName {
    /// The `slot` member.
    pub slot: Slot,
}

/// The `ObjectTemplateMember` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTemplateMember {
    /// The `name` member.
    pub name: MemberName,

    /// The `value` member.
    pub value: Template,
}

/// The `ObjectTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTemplate {
    /// The `members` member.
    pub members: Vec<ObjectTemplateMember>,

    /// The `merge` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge: Option<Slot>,
}

/// The `ArrayTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrayTemplate {
    /// The `items` member.
    pub items: Vec<Template>,
}

/// The `EachTemplate` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EachTemplate {
    /// The `of` member.
    pub of: Slot,

    /// The `as` member.
    pub r#as: Box<Template>,
}
