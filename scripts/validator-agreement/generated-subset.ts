import { refusedMembers, validatorProviderIds } from "./providers.ts";

// The validators do not generate every form of the agreement contract yet. The runner cuts the IR down to the
// schemas and operations every provider generates, and the cut is explicit: the schemas it removes are returned
// and the runner's test compares them with a committed list, so a form that starts generating shows up there.

interface IrWithSchemas {
  schemas: Record<string, unknown>;
  operations: { input?: { schema?: { kind?: string; schema?: string } } }[];
}

const SCHEMAS_POINTER = /^\/schemas\/([^/]+)/;
const OPERATIONS_POINTER = /^\/operations\/(\d+)/;

function isIrWithSchemas(ir: object): ir is IrWithSchemas {
  return "schemas" in ir && "operations" in ir && Array.isArray(ir.operations);
}

function refusedSchemaIds(ir: IrWithSchemas, members: readonly string[]): Set<string> {
  const ids = new Set<string>();

  for (const member of members) {
    const schemaId = SCHEMAS_POINTER.exec(member)?.[1];
    const operationIndex = OPERATIONS_POINTER.exec(member)?.[1];
    const operationSchema =
      operationIndex === undefined
        ? undefined
        : ir.operations[Number(operationIndex)]?.input?.schema;

    if (schemaId !== undefined) ids.add(schemaId);
    else if (operationSchema?.kind === "ref" && operationSchema.schema !== undefined) {
      ids.add(operationSchema.schema);
    } else throw new Error(`a refusal at ${member} names no schema the runner can set aside`);
  }

  return ids;
}

// A schema that names a removed one goes too, to a fixed point.
function withReferrers(ir: IrWithSchemas, removed: Set<string>): Set<string> {
  let grew = true;

  while (grew) {
    grew = false;

    for (const [id, schema] of Object.entries(ir.schemas)) {
      if (removed.has(id)) continue;

      const text = JSON.stringify(schema);

      if ([...removed].some((name) => text.includes(`"schema":${JSON.stringify(name)}`))) {
        removed.add(id);
        grew = true;
      }
    }
  }

  return removed;
}

function without(ir: IrWithSchemas, removed: ReadonlySet<string>): IrWithSchemas {
  const schemas = Object.fromEntries(Object.entries(ir.schemas).filter(([id]) => !removed.has(id)));
  const operations = ir.operations.filter(
    (operation) => !removed.has(operation.input?.schema?.schema ?? ""),
  );

  return { ...ir, schemas, operations };
}

export interface GeneratedSubset {
  ir: object;
  /** The named schemas of that IR. */
  schemas: Record<string, unknown>;
  /** The schema ids set aside because some provider does not generate them yet, sorted. */
  setAside: string[];
}

/** The IR every validators provider generates, and the schema ids that had to go to get there. */
export async function generatedSubset(whole: object): Promise<GeneratedSubset> {
  if (!isIrWithSchemas(whole)) throw new Error("the agreement IR holds no schemas and operations");

  let ir = whole;
  const setAside = new Set<string>();

  for (;;) {
    const members = (
      await Promise.all(validatorProviderIds().map((id) => refusedMembers(id, ir)))
    ).flat();

    if (members.length === 0) return { ir, schemas: ir.schemas, setAside: [...setAside].sort() };

    const removed = withReferrers(ir, refusedSchemaIds(ir, members));

    for (const id of removed) setAside.add(id);
    ir = without(ir, removed);
  }
}
