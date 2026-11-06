// The `pack:<name>` profile of a convention pack (ADR 0015 "Suite profiles"): the reader of the pack's format and
// paging style, the default cases adapted to the pack's request names and media types, and the pack's own cases.
import type { ContractIR, PagingRequestRole, PagingStyle, WireFormat } from "@seampact/spec/ir";
import { type FormatReader, FormatReaderError, formatReaderOf } from "./format-reader.js";
import { CASES_DIRECTORY, loadSuiteCases } from "./load-cases.js";
import { isJsonObject } from "./response-check.js";
import type { SampleAppScript, ScriptedAnswer } from "./sample-app-script.js";
import type {
  HeaderExpectation,
  JsonValue,
  StepExpectation,
  StepRequest,
  SuiteCase,
  SuiteProfile,
  SuiteStep,
} from "./suite-case.js";

const PACK_PACKAGE_NAME = /^@[^/]+\/pack-(.+)$/;
const PROBLEM_MEDIA = "application/problem+json";
const JSON_MEDIA = "application/json";
const ERROR_STATUS_FLOOR = 400;
const CONTENT_TYPE = "content-type";
const BARE_FORMAT = "bare";
const DEFAULT_PAGING_CONVENTION = "paging.default";

// The reference's paging style, as the shipped default cases write it.
const REFERENCE_LIMIT = "limit";
const REFERENCE_LIMIT_POINTER = `/${REFERENCE_LIMIT}`;
const REFERENCE_SORT = "sort";
const REFERENCE_CURSOR = "cursor";
const REFERENCE_SORT_STYLE = "signed";

export interface PackProfile {
  readonly profile: SuiteProfile;
  readonly reader: FormatReader;
  /** The default cases adapted to the pack, then the pack's own. */
  readonly cases: readonly SuiteCase[];
  /** The default cases the pack's request names cannot express, by case id, with the reason. */
  readonly refusals: Readonly<Record<string, string>>;
}

/** `pack:hal` for `@seampact/pack-hal`; a package that is no pack name keeps its whole name. */
export function packProfileName(packageName: string): SuiteProfile {
  return `pack:${PACK_PACKAGE_NAME.exec(packageName)?.[1] ?? packageName}`;
}

/**
 * The profile of a pack, from the IRs of the contracts the target serves: the format and paging style come from the
 * first, the api that applies the pack; the operations of all of them tell which shape a response is read with.
 */
export function packProfileOf(
  contracts: readonly [ContractIR, ...ContractIR[]],
  packageName: string,
  directory: string = CASES_DIRECTORY,
): PackProfile {
  const [ir] = contracts;
  const profile = packProfileName(packageName);
  const layer = `pack:${packageName}`;
  const format = formatOfPack(ir, packageName, layer);
  const paging = pagingOfPack(ir, packageName, layer);

  if (format === undefined && paging === undefined) {
    throw new FormatReaderError(
      `pack '${packageName}' sets no format and no paging style in this IR, so it has no profile`,
    );
  }

  const reader = readingContractPathsOnly(
    formatReaderOf(
      format ?? bareFormat(ir),
      paging,
      contracts.flatMap((contract) => contract.operations),
    ),
    contracts,
  );
  const servedApis = new Set(contracts.map((contract) => contract.api.id));
  const refusals: Record<string, string> = {};
  const totalAskingOperations = operationsAskingTotal(contracts);
  const defaultCases = loadSuiteCases("default", directory).map((suiteCase) => {
    const refusal = refusalOf(suiteCase, paging, servedApis);

    if (refusal !== undefined) refusals[suiteCase.id] = refusal;

    return adaptCase(suiteCase, limitParameterOf(paging), reader, totalAskingOperations);
  });

  return {
    profile,
    reader,
    cases: [...defaultCases, ...loadSuiteCases(profile, directory)],
    refusals,
  };
}

function formatOfPack(ir: ContractIR, packageName: string, layer: string): WireFormat | undefined {
  const formats = Object.values(ir.formats).filter((format) => format.origin.layer === layer);

  if (formats.length > 1) {
    throw new FormatReaderError(
      `pack '${packageName}' sets ${formats.length} formats (${formats.map((format) => format.id).join(", ")}); a profile reads one`,
    );
  }

  return formats[0];
}

function pagingOfPack(ir: ContractIR, packageName: string, layer: string): PagingStyle | undefined {
  const pagings = Object.values(ir.pagings).filter((paging) => paging.origin.layer === layer);
  const defaultId = ir.conventions[DEFAULT_PAGING_CONVENTION]?.value;
  const chosen = pagings.find((paging) => paging.id === defaultId) ?? pagings[0];

  if (pagings.length > 1 && chosen?.id !== defaultId) {
    throw new FormatReaderError(
      `pack '${packageName}' sets ${pagings.length} paging styles and none is the default; a profile reads one`,
    );
  }

  return chosen;
}

function bareFormat(ir: ContractIR): WireFormat {
  const bare = ir.formats[BARE_FORMAT];

  if (bare === undefined) throw new FormatReaderError("the IR holds no 'bare' format");

  return bare;
}

/**
 * A response to a path outside every surface prefix is the app's own (its 404 page), never a contract response, so
 * the pack's reader leaves it as sent.
 */
function readingContractPathsOnly(
  reader: FormatReader,
  contracts: readonly ContractIR[],
): FormatReader {
  const prefixes = contracts.flatMap((contract) =>
    Object.values(contract.api.surfaces).map((surface) => surface.prefix),
  );

  return {
    ...reader,
    read: (status, body, request) =>
      isUnderAPrefix(request.path, prefixes)
        ? reader.read(status, body, request)
        : { json: body, failures: [] },
  };
}

function isUnderAPrefix(requestPath: string, prefixes: readonly string[]): boolean {
  const queryStart = requestPath.indexOf("?");
  const path = queryStart === -1 ? requestPath : requestPath.slice(0, queryStart);

  return prefixes.some(
    (prefix) => prefix === "" || path === prefix || path.startsWith(`${prefix}/`),
  );
}

function roleOf(paging: PagingStyle | undefined, role: string): PagingRequestRole | undefined {
  return paging?.request.find((candidate) => candidate.role === role);
}

function limitParameterOf(paging: PagingStyle | undefined): string {
  return roleOf(paging, "limit")?.name ?? REFERENCE_LIMIT;
}

// A case that reaches an api the pack's app does not serve, or writes the reference's cursor or signed sort, cannot run
// against a pack that names them otherwise.
function refusalOf(
  suiteCase: SuiteCase,
  paging: PagingStyle | undefined,
  servedApis: ReadonlySet<string>,
): string | undefined {
  const unserved = (suiteCase.apis ?? []).filter((api) => !servedApis.has(api));

  if (unserved.length > 0) {
    return `the case reaches ${unserved.join(", ")}, which the pack's app does not serve`;
  }

  if (namesParameter(suiteCase, REFERENCE_CURSOR)) {
    return "the case follows the reference's cursor paging style";
  }

  const sort = roleOf(paging, "sort");
  const sortMatches = sort?.name === REFERENCE_SORT && sort.style === REFERENCE_SORT_STYLE;

  if (namesParameter(suiteCase, REFERENCE_SORT) && !sortMatches) {
    return "the case writes the reference's signed `sort` parameter, which this pack's paging style names otherwise";
  }

  return undefined;
}

function namesParameter(suiteCase: SuiteCase, name: string): boolean {
  const inPath = new RegExp(`[?&]${name}=`);

  return suiteCase.steps.some(
    (step) => name in (step.request.query ?? {}) || inPath.test(step.request.path),
  );
}

function adaptCase(
  suiteCase: SuiteCase,
  limitParameter: string,
  reader: FormatReader,
  totalAskingOperations: ReadonlySet<string>,
): SuiteCase {
  return {
    ...suiteCase,
    ...(suiteCase.script === undefined
      ? {}
      : { script: withPageTotals(suiteCase.script, totalAskingOperations) }),
    steps: suiteCase.steps.map((step) => adaptStep(step, limitParameter, reader)),
  };
}

/** The paged operations, as `<api>.<operationId>`, whose paging style asks the handler for the total. */
function operationsAskingTotal(contracts: readonly ContractIR[]): Set<string> {
  return new Set(
    contracts.flatMap((contract) =>
      contract.operations
        .filter((operation) => {
          const style = operation.paging?.style;

          return style !== undefined && contract.pagings[style]?.handlerResult.includes("total");
        })
        .map((operation) => `${contract.api.id}.${operation.id}`),
    ),
  );
}

// A default case scripts a page in the reference's handler shape, its items without a total; under a style that asks
// the handler for the total, the page answers its items' count, as a handler of that style would.
function withPageTotals(
  script: SampleAppScript,
  totalAskingOperations: ReadonlySet<string>,
): SampleAppScript {
  if (script.answers === undefined) return script;

  const answers = Object.fromEntries(
    Object.entries(script.answers).map(([operation, answer]) => [
      operation,
      totalAskingOperations.has(operation) ? withPageTotal(answer) : answer,
    ]),
  );

  return { ...script, answers };
}

function withPageTotal(answer: ScriptedAnswer): ScriptedAnswer {
  if (!("status" in answer) || answer.body === undefined || !isJsonObject(answer.body)) {
    return answer;
  }

  const { items } = answer.body;

  if (!Array.isArray(items) || "total" in answer.body) return answer;

  return { ...answer, body: { ...answer.body, total: items.length } };
}

function adaptStep(step: SuiteStep, limitParameter: string, reader: FormatReader): SuiteStep {
  const isError = step.expect.status >= ERROR_STATUS_FLOOR;

  return {
    ...step,
    request: renameLimit(step.request, limitParameter),
    expect: isError
      ? renameLimitPointer(
          replaceMedia(step.expect, PROBLEM_MEDIA, reader.errorMedia),
          limitParameter,
        )
      : replaceMedia(step.expect, JSON_MEDIA, reader.media),
  };
}

// An issue the case expects on the reference's limit parameter sits on the pack's name for it.
function renameLimitPointer(expectation: StepExpectation, limitParameter: string): StepExpectation {
  const body = expectation.body;

  if (limitParameter === REFERENCE_LIMIT || body === undefined || !isJsonObject(body)) {
    return expectation;
  }

  if (!Array.isArray(body.issues)) return expectation;

  const renamed = body.issues.map((issue: JsonValue) =>
    isJsonObject(issue) && issue.pointer === REFERENCE_LIMIT_POINTER
      ? { ...issue, pointer: `/${limitParameter}` }
      : issue,
  );

  return { ...expectation, body: { ...body, issues: renamed } };
}

function renameLimit(request: StepRequest, limitParameter: string): StepRequest {
  if (limitParameter === REFERENCE_LIMIT) return request;

  const query =
    request.query === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(request.query).map(([name, value]) => [
            name === REFERENCE_LIMIT ? limitParameter : name,
            value,
          ]),
        );

  return {
    ...request,
    path: request.path
      .replace(`?${REFERENCE_LIMIT}=`, `?${limitParameter}=`)
      .replace(`&${REFERENCE_LIMIT}=`, `&${limitParameter}=`),
    ...(query === undefined ? {} : { query }),
  };
}

// The default cases expect the bare format's media types; a pack's format writes its own.
function replaceMedia(
  expectation: StepExpectation,
  bareMedia: string,
  packMedia: string,
): StepExpectation {
  const contentType = expectation.headers?.[CONTENT_TYPE];

  if (contentType === undefined || bareMedia === packMedia) return expectation;

  const replaced: HeaderExpectation = {
    ...contentType,
    ...(contentType.equals === undefined
      ? {}
      : { equals: contentType.equals.replace(bareMedia, packMedia) }),
    ...(contentType.contains === undefined
      ? {}
      : { contains: contentType.contains.map((part) => part.replace(bareMedia, packMedia)) }),
    ...(contentType.excludes === undefined
      ? {}
      : { excludes: contentType.excludes.replace(bareMedia, packMedia) }),
  };

  return { ...expectation, headers: { ...expectation.headers, [CONTENT_TYPE]: replaced } };
}
