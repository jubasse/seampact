import type { WireNameLimit } from "@seampact/codegen-core/validators";

// VineJS writes the path of an issue as one dotted string, `a.0.c`: a name with a dot or a bracket, or an empty one,
// cannot be told from a nested path in it. VineJS also compiles each name into JavaScript source unescaped: a quote,
// a backslash, a line break or another control character breaks that source or runs as code.
export const VINE_WIRE_NAME_LIMIT: WireNameLimit = {
  unsafe: /^$|[.[\]'"\\\p{Cc}\u2028\u2029]/u,
  form: "wire.name.vinePath",
  description: (wireName) =>
    `The wire name ${JSON.stringify(wireName)}, which VineJS's field paths and compiled validators cannot hold exactly,`,
};
