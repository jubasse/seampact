import type { Refusal } from "@seampact/codegen-core";
import type { NativeDocsContract } from "@seampact/codegen-core/node-server";
import type { ContractIR } from "@seampact/spec/ir";

// The `nestjs-docs` module of one api: per operation the decorators that give `@nestjs/swagger` seampact's
// operation object (ADR 0009 "Artefacts and the compatibility matrix"), and the components the app passes to
// `createDocument`. Operation objects are copied from the api's OpenAPI document, never re-derived.

const RESPONSES_MEMBER = "responses";
const PARAMETERS_MEMBER = "parameters";
const REQUEST_BODY_MEMBER = "requestBody";
const CONTENT_MEMBER = "content";
const SCHEMA_MEMBER = "schema";

interface JsonRecord {
  readonly [member: string]: unknown;
}

// `@nestjs/swagger` gives every media type of a request body the one schema its `ApiBody` holds.
function requestBodyOf(
  operationId: string,
  requestBody: unknown,
  refusals: Refusal[],
): { media: string[]; options: JsonRecord } | undefined {
  if (!isRecord(requestBody)) return undefined;

  const { [CONTENT_MEMBER]: content, ...rest } = requestBody;
  const media = isRecord(content) ? Object.keys(content) : [];
  const schemas = new Set(
    Object.values(isRecord(content) ? content : {}).map((entry) =>
      JSON.stringify(isRecord(entry) ? entry[SCHEMA_MEMBER] : undefined),
    ),
  );

  if (schemas.size > 1) {
    refusals.push({
      code: "nativeDocs.requestBody.media.unsupported",
      message: `The request body of '${operationId}' has media types with different schemas, and \`@nestjs/swagger\` gives one schema to all the media types of a body.`,
      fix: "Give the body one schema for every media type, or turn `nativeDocs` off for this api.",
      operation: operationId,
    });
  }

  const [firstMedia] = media;
  const firstEntry =
    isRecord(content) && firstMedia !== undefined ? content[firstMedia] : undefined;
  const schema = isRecord(firstEntry) ? firstEntry[SCHEMA_MEMBER] : undefined;

  return { media, options: { ...rest, ...(schema === undefined ? {} : { schema }) } };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nestjsDocsModuleSource(
  ir: ContractIR,
  contract: NativeDocsContract,
  refusals: Refusal[],
): string {
  const operations = ir.operations.map((operation) => {
    const documented = contract.operations.get(operation.id);

    if (documented === undefined) {
      throw new Error(`The reader passed no document for operation '${operation.id}'.`);
    }

    const {
      [RESPONSES_MEMBER]: responses,
      [PARAMETERS_MEMBER]: parameters,
      [REQUEST_BODY_MEMBER]: requestBody,
      ...rest
    } = documented.operation;
    const body = requestBodyOf(operation.id, requestBody, refusals);
    const docs = { operation: rest, parameters: parameters ?? [], body, responses };

    return `${JSON.stringify(operation.id)}: ${JSON.stringify(JSON.stringify(docs))},`;
  });

  return [
    'import { applyDecorators } from "@nestjs/common";',
    "import {",
    "  ApiBody,",
    "  ApiConsumes,",
    "  ApiOperation,",
    "  type ApiOperationOptions,",
    "  ApiParam,",
    "  type ApiParamOptions,",
    "  ApiResponse,",
    "  type ApiResponseOptions,",
    '} from "@nestjs/swagger";',
    'import { assertOpenApi31, type ComponentSections, mergeComponents } from "./native-docs/contract-document.js";',
    "",
    `const API_ID = ${JSON.stringify(ir.api.id)};`,
    "",
    "interface ContractOperationDocs {",
    "  operation: ApiOperationOptions;",
    "  parameters: ApiParamOptions[];",
    "  body?: { media: string[]; options: Parameters<typeof ApiBody>[0] };",
    "  responses: Record<string, ApiResponseOptions>;",
    "}",
    "",
    "// Each value is JSON text, parsed per call: a fresh object for every decorator, as `@nestjs/swagger` keeps what it is given.",
    "const OPERATION_DOCS: Readonly<Record<string, string>> = {",
    ...operations,
    "};",
    "",
    `const CONTRACT_COMPONENTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = ${JSON.stringify(contract.components)};`,
    "",
    "/** The decorators that describe the operation to `@nestjs/swagger`; the operation decorator applies them. */",
    "export function contractDocs(operationId: string): MethodDecorator {",
    "  const text = OPERATION_DOCS[operationId];",
    "",
    `  if (text === undefined) throw new Error(\`seampact: api '\${API_ID}' has no documented operation '\${operationId}'.\`);`,
    "",
    "  const { operation, parameters, body, responses }: ContractOperationDocs = JSON.parse(text);",
    "",
    "  return applyDecorators(",
    "    ApiOperation(operation),",
    "    // `ApiParam` keeps the `in` it is given, so it writes every location verbatim.",
    "    ...parameters.map((parameter) => ApiParam(parameter)),",
    "    ...(body === undefined ? [] : [ApiConsumes(...body.media), ApiBody(body.options)]),",
    "    ...Object.entries(responses).map(([status, response]) => ApiResponse({ status: Number(status), ...response })),",
    "  );",
    "}",
    "",
    "/**",
    " * Adds the api's components (schemas, security schemes) to the config given to `SwaggerModule.createDocument`,",
    " * which must say `openapi: '3.1.0'`; call it once per api of the app. A component the config already holds with",
    " * another value throws.",
    " */",
    "export function withContractComponents<Config extends { openapi?: string; components?: object }>(config: Config): Config {",
    "  assertOpenApi31(config.openapi, API_ID);",
    "",
    "  const held: ComponentSections = Object.fromEntries(Object.entries(config.components ?? {}));",
    "",
    "  return { ...config, components: mergeComponents(held, CONTRACT_COMPONENTS, API_ID) };",
    "}",
    "",
  ].join("\n");
}
