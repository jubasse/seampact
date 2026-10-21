import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ContractIR,
  Operation,
  Param,
  PagingRequestRole,
  PagingStyle,
  Template,
} from "@seampact/spec/ir";
import type { Target } from "../target.js";
import { type RawReply, sendRawRequest } from "./live-request.test-support.js";
import {
  copyTestApp,
  emitProject,
  generateReferenceProject,
  projectDirectory,
} from "./reference-project.test-support.js";

// The booted pages tests of the Node server targets: the tasks api of a pack golden with its lists moved to other
// paging styles, served by a target's test app, and the handler answers a page of two channels.

const GOLDEN = new URL("../../../../../fixtures/golden/", import.meta.url);
const PAGING_PARAMS_DERIVATION = "paging.params";

const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };

export const PAGE_CHANNEL = "11111111-1111-4111-8111-111111111111";
export const PAGE_CHANNELS = [
  { channelId: PAGE_CHANNEL, name: "General" },
  { channelId: "22222222-2222-4222-8222-222222222222", name: "Random" },
];

interface PagesAppModule {
  readonly scenario: { answers: Record<string, (input: unknown) => unknown> };
  resetScenario(): void;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

/** A generated pages api served by a target's test app. */
export interface BootedPages {
  app: PagesAppModule;
  send(path: string): Promise<RawReply>;
  close(): Promise<void>;
}

/** Where a pages api boots: the test file, its project name, the target and the target's test app. */
export interface PagesProject {
  testFileUrl: string;
  name: string;
  target: Target;
  appSource: URL;
}

export function packIr(pack: string, api: string): ContractIR {
  return JSON.parse(readFileSync(new URL(`${pack}/${api}.ir.json`, GOLDEN), "utf8"));
}

export function slot(name: string): Template {
  return { kind: "slot", slot: name, path: [] };
}

export function objectOf(members: Record<string, Template>): Template {
  return {
    kind: "object",
    members: Object.entries(members).map(([name, value]) => ({
      name: { kind: "text", text: name },
      value,
    })),
  };
}

export function requirePaging(ir: ContractIR, styleId: string): PagingStyle {
  const style = ir.pagings[styleId];

  if (style === undefined) throw new Error(`the pack golden lost its paging style '${styleId}'`);

  return style;
}

/** Moves a list to a paging style, its paging query params kept. */
export function withStyle(ir: ContractIR, operationId: string, style: PagingStyle): ContractIR {
  return {
    ...ir,
    pagings: { ...ir.pagings, [style.id]: style },
    operations: ir.operations.map((operation): Operation => {
      if (operation.id !== operationId || operation.paging === undefined) return operation;

      return { ...operation, paging: { ...operation.paging, style: style.id } };
    }),
  };
}

/** Moves a list to a paging style whose request roles differ, its paging query params written from those roles. */
export function withRequestStyle(
  ir: ContractIR,
  operationId: string,
  style: PagingStyle,
): ContractIR {
  const moved = withStyle(ir, operationId, style);

  return {
    ...moved,
    operations: moved.operations.map((operation): Operation => {
      if (operation.id !== operationId) return operation;

      return {
        ...operation,
        params: {
          ...operation.params,
          query: [
            ...operation.params.query.filter(
              (param) => param.derivedFrom?.derivation !== PAGING_PARAMS_DERIVATION,
            ),
            ...style.request.map((role) => pagingParam(operation, role)),
          ],
        },
      };
    }),
  };
}

// A query param for a request role, derived as the list's own paging params are: a number for the limit and the
// offset, text for a cursor or a since token.
function pagingParam(operation: Operation, role: PagingRequestRole): Param {
  const model = operation.params.query.find(
    (param) => param.derivedFrom?.derivation === PAGING_PARAMS_DERIVATION,
  );

  if (model === undefined) throw new Error(`the list '${operation.id}' has no paging param`);

  const isNumber = role.role === "limit" || role.role === "offset";

  return {
    ...model,
    name: role.name,
    type: {
      kind: "scalar",
      type: isNumber ? "integer" : "string",
      refinements: isNumber ? { minimum: role.role === "limit" ? "1" : "0" } : {},
    },
    wire: { kind: isNumber ? "number" : "text", style: "form", explode: true, brackets: false },
  };
}

export function queryRole(role: PagingRequestRole["role"], name: string): PagingRequestRole {
  return { role, in: "query", name };
}

export async function bootPages(
  project: PagesProject,
  changeIr: (api: string) => ContractIR,
): Promise<BootedPages> {
  const directory = projectDirectory(project.testFileUrl, project.name);
  const build = join(directory, "build");
  const files = await generateReferenceProject(
    directory,
    project.target,
    { bodyValidation: true },
    (_ir, api) => changeIr(api),
  );
  const compileErrors = emitProject(directory, files, build);

  if (compileErrors.length > 0) {
    throw new Error(`the generated pages api does not compile:\n${compileErrors.join("\n")}`);
  }

  const app: PagesAppModule = await import(copyTestApp(build, project.appSource));
  const server = await app.startReferenceApp();

  return {
    app,
    send: (path) => sendRawRequest(server, "GET", path, { headers: BEARER }),
    close: () => server.close(),
  };
}

/** The handler of a list answers the two channels and the page facts given. */
export function answerPage(
  booted: BootedPages,
  operationId: string,
  facts: Readonly<Record<string, unknown>>,
): void {
  booted.app.scenario.answers[operationId] = () => ({
    status: 200,
    body: { items: PAGE_CHANNELS, ...facts },
  });
}

/** An offset style from a pack's page style: the offset and limit in the query, the total beside the items. */
function offsetPages(pageStyle: PagingStyle): PagingStyle {
  return {
    ...pageStyle,
    id: "offsetPages",
    position: "offset",
    absent: "omit",
    request: [queryRole("offset", "offset"), queryRole("limit", "limit")],
    handlerResult: ["total"],
    response: {
      body: objectOf({
        items: slot("items"),
        total: slot("total"),
        offset: slot("offset"),
        from: slot("from"),
        to: slot("to"),
        next: slot("next"),
        previous: slot("previous"),
      }),
      meta: [],
      headers: [],
      links: [
        { rel: "next", role: "next" },
        { rel: "prev", role: "previous" },
      ],
    },
  };
}

/** The Laravel tasks api, its channel list on the offset style. */
export function laravelOffsetChannels(api: string): ContractIR {
  const ir = packIr("pack-laravel", api);

  if (api !== "tasks") return ir;

  return withRequestStyle(ir, "listChannels", offsetPages(requirePaging(ir, "laravelPages")));
}
