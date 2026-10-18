// The template reader of ADR 0002 section 13, shared by every half that reads a template: the caller gives the
// slots of the place and a reporter for its own rule ids.

export type {
  TemplateFault,
  TemplateRule,
  TemplateSite,
  TemplateSlot,
  TemplateSlotKind,
  TemplateSlotUse,
} from "./reader.js";
export { templateRead, templateSlots, templateUses } from "./reader.js";
