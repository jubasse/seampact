import type { ContractIR, SourceMap } from "@seampact/spec/ir";
import { isRecord } from "../is-record.js";

// The IR an api's targets read, with the compiler's side table of where each declaration is written. A bundle
// source carries no table, so its refusals keep the IR pointer only.
export interface ContractPositions {
  readonly ir: ContractIR;
  readonly locations?: SourceMap["locations"];
}

// The contract `file:line` of an IR member: the deepest node on its pointer whose origin the side table locates,
// else the operation's own declaration, as `explain` locates it.
export function contractPosition(
  positions: ContractPositions,
  member: string | undefined,
  operationId: string | undefined,
): string | undefined {
  const { ir, locations } = positions;

  if (locations === undefined) return undefined;

  const nodes = member === undefined ? [] : nodesAlong(ir, member);

  for (const node of nodes.reverse()) {
    const position = locatedOrigin(node, locations);

    if (position !== undefined) return position;
  }

  const operation = ir.operations.find((each) => each.id === operationId);

  return operation === undefined ? undefined : locatedOrigin(operation, locations);
}

// Each value the JSON Pointer passes through, from the IR root to the member, as far as the IR holds it.
function nodesAlong(ir: ContractIR, pointer: string): unknown[] {
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  const nodes: unknown[] = [ir];
  let node: unknown = ir;

  for (const token of tokens) {
    node = childOf(node, token);

    if (node === undefined) break;

    nodes.push(node);
  }

  return nodes;
}

function childOf(node: unknown, token: string): unknown {
  if (Array.isArray(node)) return node[Number(token)];

  if (isRecord(node) && Object.hasOwn(node, token)) return node[token];

  return undefined;
}

function locatedOrigin(node: unknown, locations: SourceMap["locations"]): string | undefined {
  return isRecord(node) ? originPosition(node.origin, locations) : undefined;
}

// The `file:line` of an origin through the side table. A core declaration has no file, and an element of another
// api is located in that api's table.
export function originPosition(
  origin: unknown,
  locations: SourceMap["locations"],
): string | undefined {
  if (!isRecord(origin)) return undefined;

  const { layer, pointer, api } = origin;

  if (layer === "core" || api !== undefined) return undefined;

  const key = `${String(layer)}#${String(pointer)}`;
  const location = Object.hasOwn(locations, key) ? locations[key] : undefined;

  return location === undefined ? undefined : `${location.file}:${location.line}`;
}
