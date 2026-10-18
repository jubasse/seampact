import type { IrWriter } from "@seampact/spec/ir";
import {
  type ConventionReading,
  pipelineCopy,
  pipelineIsJsonObject,
  pipelineParseDuration,
  pipelineTreeNodes,
} from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import {
  DERIVE_WIRE_STRING_USE,
  deriveWireAddParam,
  deriveWireAddSuccessHeader,
} from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The idempotency key (`idempotency.write`, A34, ADR 0002 section 13, ADR 0006 section 5). Opt-in: an unset
// `conventions.idempotency` derives no key. The key reaches a non-safe operation whose method `methods` lists and
// whose identity is not signed (a signed identity never takes one, ADR 0013). There, an inherited
// `idempotency: { exempt }` is written as the exemption; otherwise `idempotency` holds the convention's settings,
// the key header parameter (required unless `required: false`) follows, and with `enforce: boundary` the replay
// header goes on every success response. A written exemption that reaches no operation the key reaches is a compile
// error naming the unused reason. `header`, `replayHeader` and `lifetime` have no default: a convention without
// one of them is a compile error.

const IDEMPOTENCY = "idempotency.write";

const BOOLEAN_USE: IrWriter.ScalarTypeUse = Object.freeze({
  kind: "scalar",
  type: "boolean",
  refinements: Object.freeze({}),
});

/** The idempotency convention, read once per api. */
export interface DeriveWireIdempotencyConvention {
  readonly header: string;
  readonly replayHeader: string;
  readonly lifetimeMs: number;
  readonly methods: readonly string[];
  readonly required: boolean;
  readonly enforce: IrWriter.IdempotencyEnforcement;
  readonly origin: IrWriter.Origin;
}

/** Tracks which written exemptions an operation the key reaches inherits. */
export interface DeriveWireExemptions {
  readonly used: Set<string>;
}

/** The convention as read: unset, refused (and reported), or its settings. */
export type DeriveWireIdempotencyReading =
  | { readonly state: "unset" }
  | { readonly state: "refused" }
  | { readonly state: "set"; readonly convention: DeriveWireIdempotencyConvention };

const UNSET: DeriveWireIdempotencyReading = Object.freeze({ state: "unset" });

const REFUSED: DeriveWireIdempotencyReading = Object.freeze({ state: "refused" });

/** Reads `conventions.idempotency`, reporting one that misses a member without a default. */
export function deriveWireIdempotencyConvention(
  scope: DeriveWireScope,
): DeriveWireIdempotencyReading {
  const conventions = scope.context.conventions;
  // `methods` defaults only within a written `idempotency`, so its reading tells whether the convention is set.
  const methods = conventions.get("idempotency.methods");

  if (methods === undefined) return UNSET;

  const header = textOf(conventions.get("idempotency.header"), "header");
  const replayHeader = textOf(conventions.get("idempotency.replayHeader"), "replayHeader");
  const lifetime = textOf(conventions.get("idempotency.lifetime"), "lifetime");
  const lifetimeMs = lifetime === undefined ? undefined : pipelineParseDuration(lifetime);
  const origin = conventionOrigin(scope);

  if (header === undefined || replayHeader === undefined || lifetimeMs === undefined) {
    reportIncomplete({ header, replayHeader, lifetime }, origin, scope);

    return REFUSED;
  }

  const convention: DeriveWireIdempotencyConvention = {
    header,
    replayHeader,
    lifetimeMs,
    methods: stringList(methods),
    required: conventions.get("idempotency.required")?.value !== false,
    enforce: enforcementOf(conventions.get("idempotency.enforce")),
    origin,
  };

  return { state: "set", convention };
}

/** Writes the route's idempotency member, key parameter and replay header. */
export function deriveWireIdempotency(
  route: DeriveWireRoute,
  reading: DeriveWireIdempotencyReading,
  exemptions: DeriveWireExemptions,
  scope: DeriveWireScope,
): void {
  const exemption = scope.context.inherited(route.node, "idempotency");

  // A relay route has no method until tree.nodes copies the relayed one, so whether the key reaches it is not
  // known yet: it gets no key, and its exemption is not refused as unused. Like the relay tolerance of the
  // credentials and the identity headers, this becomes an internal error once tree.nodes copies the method.
  if (route.node.kind === "relay" && route.operation.safe === undefined) {
    if (exemption !== undefined) exemptions.used.add(exemption.entry.node.pointer);

    return;
  }

  if (reading.state !== "set" || !keyReaches(route, reading.convention, scope)) return;

  if (exemption !== undefined) {
    const { value, origin } = exemption.entry;
    const reason = pipelineIsJsonObject(value) ? value.exempt : undefined;

    if (typeof reason !== "string")
      throw new Error(`the idempotency setting at ${origin.pointer} is no exemption`);

    exemptions.used.add(exemption.entry.node.pointer);
    route.operation.idempotency = { kind: "exempt", reason, origin: pipelineCopy(origin) };

    return;
  }

  writeKey(route, reading.convention, scope);
}

function writeKey(
  route: DeriveWireRoute,
  convention: DeriveWireIdempotencyConvention,
  scope: DeriveWireScope,
): void {
  const derivedFrom: IrWriter.DerivedFrom = {
    derivation: IDEMPOTENCY,
    from: [pipelineCopy(convention.origin)],
  };

  route.operation.idempotency = {
    kind: "derived",
    header: convention.header,
    replayHeader: convention.replayHeader,
    lifetimeMs: convention.lifetimeMs,
    required: convention.required,
    enforce: convention.enforce,
    derivedFrom: pipelineCopy(derivedFrom),
  };

  deriveWireAddParam(
    route,
    "header",
    {
      name: convention.header,
      type: DERIVE_WIRE_STRING_USE,
      required: convention.required,
      derivedFrom,
    },
    scope,
  );

  if (convention.enforce === "boundary")
    deriveWireAddSuccessHeader(
      route,
      { name: convention.replayHeader, type: BOOLEAN_USE, required: false, derivedFrom },
      undefined,
      scope,
    );
}

/**
 * Reports each written exemption no operation the key reaches inherits. Under a refused convention no route gets a
 * key, so its exemptions are not reported again.
 */
export function deriveWireCheckExemptions(
  reading: DeriveWireIdempotencyReading,
  exemptions: DeriveWireExemptions,
  scope: DeriveWireScope,
): void {
  if (reading.state === "refused") return;

  for (const written of writtenExemptions(scope)) {
    if (exemptions.used.has(written.nodePointer)) continue;

    scope.reporter.error({
      rule: "idempotency-exempt-unused",
      message: `the idempotency exemption ${quote(written.reason)} reaches no route the idempotency key reaches${reading.state === "unset" ? ": conventions.idempotency is unset" : ""}`,
      fix: "Remove the exemption, or move it to the non-safe routes the key reaches (a method conventions.idempotency.methods lists, an identity that is not signed).",
      pointer: `${written.nodePointer}/idempotency`,
    });
  }
}

interface WrittenExemption {
  readonly nodePointer: string;
  readonly reason: string;
}

// The validate stage admits only `{ exempt: <reason> }` as a node's `idempotency`.
function writtenExemptions(scope: DeriveWireScope): WrittenExemption[] {
  const written: WrittenExemption[] = [];

  for (const node of pipelineTreeNodes(scope.context.raw)) {
    const setting = node.settings.idempotency;
    const reason = pipelineIsJsonObject(setting) ? setting.exempt : undefined;

    if (typeof reason === "string") written.push({ nodePointer: node.pointer, reason });
  }

  return written;
}

function keyReaches(
  route: DeriveWireRoute,
  convention: DeriveWireIdempotencyConvention,
  scope: DeriveWireScope,
): boolean {
  const { safe, method, access } = route.operation;

  if (safe === undefined || method === undefined)
    throw new Error(`tree.nodes wrote no method or safe on operation '${route.id}'`);

  if (safe || !convention.methods.includes(method)) return false;

  if (access === undefined || access.kind === "public") return true;

  const identities = scope.draft.identities;
  const identity = Object.hasOwn(identities, access.identity)
    ? identities[access.identity]
    : undefined;

  return identity?.kind !== "signed";
}

const ENFORCEMENTS: readonly IrWriter.IdempotencyEnforcement[] = ["boundary", "none"];

// `enforce` defaults to `boundary` (ADR 0002 section 13); the authoring schema refuses any other value.
function enforcementOf(reading: ConventionReading | undefined): IrWriter.IdempotencyEnforcement {
  const value = reading?.value ?? "boundary";
  const enforcement = ENFORCEMENTS.find((known) => known === value);

  if (enforcement === undefined)
    throw new Error(
      `conventions.idempotency.enforce is ${JSON.stringify(value)}, which the authoring schema refuses`,
    );

  return enforcement;
}

// A member left unset reads undefined; one that is no string the authoring schema refuses.
function textOf(reading: ConventionReading | undefined, member: string): string | undefined {
  if (reading === undefined) return undefined;

  if (typeof reading.value !== "string")
    throw new Error(
      `conventions.idempotency.${member} is no string, which the authoring schema refuses`,
    );

  return reading.value;
}

function stringList(reading: ConventionReading): string[] {
  const value = reading.value;

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(
      "conventions.idempotency.methods is no list of methods, which the authoring schema refuses",
    );

  return [...value];
}

// The pointer of `conventions.idempotency` as written: every member is written in one layer's mapping or another,
// and the methods default carries no origin, so the origin is read at the object itself.
function conventionOrigin(scope: DeriveWireScope): IrWriter.Origin {
  const origin = scope.context.origin("/conventions/idempotency");

  if (origin === undefined)
    throw new Error("conventions.idempotency is set but has no origin in the side table");

  return origin;
}

function reportIncomplete(
  readings: Record<"header" | "replayHeader" | "lifetime", string | undefined>,
  origin: IrWriter.Origin,
  scope: DeriveWireScope,
): void {
  const missing = Object.entries(readings)
    .filter(([, text]) => text === undefined)
    .map(([key]) => key);
  const what =
    missing.length > 0
      ? `sets no ${missing.join(", ")}`
      : "has a lifetime longer than any duration the compiler can hold";

  scope.reporter.error({
    rule: "idempotency-convention",
    message: `conventions.idempotency ${what}, so no idempotency key can be derived`,
    fix: "Write header, replayHeader and lifetime in conventions.idempotency (Idempotency-Key, Idempotency-Replayed, 24h), or remove it.",
    pointer: origin.pointer,
  });
}
