import type { Origin } from "@seampact/spec/ir";
import { canonicalId } from "@seampact/spec/naming";
import type { Diagnostic, RelatedLocation } from "../diagnostics/diagnostic.js";
import { type DraftIR, type DraftOperation, pipelineCopy } from "../pipeline/seam.js";
import { isDiagnosticOrigin } from "../workspace/order.js";

// The id collision check of finalize (ADR 0004 section 9, ADR 0006 section 3): every name that becomes a key of
// `components.schemas` in a document is distinct. Those names are the ids of the schemas (declared and hoisted),
// the enums and the named formats, and `<schema id>.input`, the strict input component of a schema; an error code
// equal to one of them, the input name of an operation that reads body proofs equal to another id, or two
// catalogues sharing an id is a compile error naming both. The names are the ids themselves, which no document
// option changes, so the check holds under every option.

export const FINALIZE_ID_COLLISION_RULE = "seampact/finalize/id-collision";

const INPUT_ROLE = "input";
const STRICT_INPUT_SUFFIX = ".input";

/** One side of a collision: what it is, in a message's words, and where it is declared. */
interface CollisionSide {
  readonly what: string;
  readonly origin: Origin | undefined;
}

/** A name that becomes a key of `components.schemas`. */
interface ComponentName extends CollisionSide {
  readonly key: string;
}

// The component names of the IR, in catalogue order: schemas, enums, named formats, then the strict inputs.
function componentNames(ir: DraftIR): ComponentName[] {
  const schemas = Object.entries(ir.schemas);

  return [
    ...schemas.map(([id, schema]) => ({
      key: id,
      what: `the schema '${id}'`,
      origin: schema.origin,
    })),
    ...Object.entries(ir.enums).map(([id, entry]) => ({
      key: id,
      what: `the enum '${id}'`,
      origin: entry.origin,
    })),
    ...Object.entries(ir.scalars).map(([id, scalar]) => ({
      key: id,
      what: `the named format '${id}'`,
      origin: scalar.origin,
    })),
    ...schemas.map(([id, schema]) => ({
      key: `${id}${STRICT_INPUT_SUFFIX}`,
      what: `the strict input '${id}${STRICT_INPUT_SUFFIX}' of the schema '${id}'`,
      origin: schema.origin,
    })),
  ];
}

// The diagnostic located at `located`, or at `other` when `located` is a core declaration, which has no file
// (ADR 0004 section 11); a core side is named in the message but has no related location.
function collisionDiagnostic(
  located: CollisionSide,
  other: CollisionSide,
  text: (first: CollisionSide, second: CollisionSide) => { message: string; fix: string },
): Diagnostic {
  const [first, second] =
    located.origin !== undefined && isDiagnosticOrigin(located.origin)
      ? [located, other]
      : [other, located];

  if (first.origin === undefined || !isDiagnosticOrigin(first.origin))
    throw new Error(
      `finalize found ${located.what} and ${other.what} under one id, and neither has an authored origin to locate it at`,
    );
  const related: RelatedLocation[] =
    second.origin !== undefined && isDiagnosticOrigin(second.origin)
      ? [{ origin: pipelineCopy(second.origin), message: `${second.what} is declared here` }]
      : [];

  return {
    severity: "error",
    rule: FINALIZE_ID_COLLISION_RULE,
    origin: pipelineCopy(first.origin),
    related,
    ...text(first, second),
  };
}

// Two catalogues sharing an id: located at the first in catalogue order (a schema before an enum before a format).
function catalogueCollisions(names: readonly ComponentName[]): Diagnostic[] {
  const claimed = new Map<string, ComponentName>();
  const diagnostics: Diagnostic[] = [];

  for (const name of names) {
    const first = claimed.get(name.key);

    if (first === undefined) {
      claimed.set(name.key, name);
      continue;
    }

    diagnostics.push(
      collisionDiagnostic(first, name, (one, two) => ({
        message: `${capitalized(one.what)} and ${two.what} have one id, so a document would write both as the component '${name.key}'.`,
        fix: "Rename one of them.",
      })),
    );
  }

  return diagnostics;
}

const capitalized = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// An error code equal to a component name, located at the code.
function codeCollisions(ir: DraftIR, components: ReadonlyMap<string, ComponentName>): Diagnostic[] {
  return Object.entries(ir.errors).flatMap(([code, declaration]) => {
    const component = components.get(code);

    if (component === undefined) return [];
    const side: CollisionSide = { what: `the error code '${code}'`, origin: declaration.origin };

    return [
      collisionDiagnostic(side, component, () => ({
        message: `The error code '${code}' equals the id of ${component.what}, so a document would write both as the component '${code}'.`,
        fix: "Rename the code.",
      })),
    ];
  });
}

// The input name of an operation that reads body proofs (ADR 0004 section 13), when it is not the operation's own
// input schema, which already carries that name.
function proofInputName(operation: DraftOperation): string | undefined {
  const input = operation.input;

  if (operation.name === undefined || input?.proofs === undefined || input.proofs.length === 0)
    return undefined;
  const inputName = canonicalId({ segments: operation.name.segments, role: INPUT_ROLE });
  const ownSchema = input.schema.kind === "ref" ? input.schema.schema : undefined;

  return inputName === ownSchema ? undefined : inputName;
}

// A proof input name equal to another id: a component name or an error code, located at the operation.
function proofInputCollisions(
  ir: DraftIR,
  components: ReadonlyMap<string, ComponentName>,
): Diagnostic[] {
  return ir.operations.flatMap((operation) => {
    const inputName = proofInputName(operation);

    if (inputName === undefined) return [];
    const code = Object.hasOwn(ir.errors, inputName) ? ir.errors[inputName] : undefined;
    const other: CollisionSide | undefined =
      components.get(inputName) ??
      (code === undefined
        ? undefined
        : { what: `the error code '${inputName}'`, origin: code.origin });

    if (other === undefined) return [];
    const side: CollisionSide = {
      what: `the operation '${operation.id}'`,
      origin: operation.origin,
    };

    return [
      collisionDiagnostic(side, other, () => ({
        message: `The operation '${operation.id}' reads body proofs, so its input is the component '${inputName}', which is also the id of ${other.what}.`,
        fix: `Rename the operation '${operation.id}' or ${other.what}.`,
      })),
    ];
  });
}

/** Every id collision of `ir`, finalize's pruned copy of the draft, in catalogue, then code, then operation order. */
export function finalizeIdCollisions(ir: DraftIR): Diagnostic[] {
  const names = componentNames(ir);
  const components = new Map<string, ComponentName>();

  for (const name of names) if (!components.has(name.key)) components.set(name.key, name);

  return [
    ...catalogueCollisions(names),
    ...codeCollisions(ir, components),
    ...proofInputCollisions(ir, components),
  ];
}
