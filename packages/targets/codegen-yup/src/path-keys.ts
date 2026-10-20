import type { WireNameLimit } from "@seampact/codegen-core/validators";

// yup writes the path of an issue as one string, `a["c.d"][0]`. A name with a quote or a bracket, or an empty
// one, cannot be told from a nested path in it.
export const YUP_WIRE_NAME_LIMIT: WireNameLimit = {
  unsafe: /^$|["[\]]/,
  form: "wire.name.yupPath",
  description: (wireName) =>
    `The wire name '${wireName}', which yup's issue path cannot carry exactly,`,
};
