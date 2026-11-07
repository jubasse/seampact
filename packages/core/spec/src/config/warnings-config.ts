import type { JsonSchema } from "../authoring/schemas.js";

// The `warnings` key of the app config: the generate warnings the app silences by form. A form is what a warning
// is about, such as `paging.sortKeys`; its warning code is the form followed by `.handler`, and either spelling
// silences it.

export interface AppWarnings {
  ignore?: string[];
}

export const APP_WARNINGS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ignore: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
  },
};
