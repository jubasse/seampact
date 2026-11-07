// The baseline's request schemas written once as class-validator classes, run through NestJS's `ValidationPipe`
// set strict (unknown properties refused, no implicit conversion), the way a NestJS app validates its DTOs.
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import { DATE_TIME, NAME_MAX, type RouteOutput } from "./response-facts.mjs";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TITLE_MAX = 200;
const LIST_LIMIT_MAX = 50;
const STATES = ["open", "done", "archived"];
const SORT_KEYS = ["createdAt", "-createdAt"];

class ChannelPath {
  @Matches(UUID) channelId!: string;
}

class TaskPath {
  @Matches(UUID) channelId!: string;
  @Matches(UUID) taskId!: string;
}

class NoQuery {}

class ListTasksQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(LIST_LIMIT_MAX) limit?: number;
  @IsOptional() @IsArray() @IsIn(SORT_KEYS, { each: true }) sort?: string[];
}

class CreateTaskBody {
  @IsString() @Length(1, TITLE_MAX) title!: string;
  @IsOptional() @IsInt() @Min(0) effort?: number;
}

class UpdateTaskBody {
  @IsOptional() @IsString() @Length(1, TITLE_MAX) title?: string;
  @IsOptional() @IsIn(STATES) state?: string;
  @IsOptional() @IsInt() @Min(0) effort?: number;
  @IsInt() @Min(1) expectedVersion!: number;
}

class PaymentEventBody {
  @IsString() id!: string;
  @IsString() type!: string;
  @IsDefined() data!: unknown;
}

class HealthResponse {
  @IsString() status!: string;
}

class ChannelResponse {
  @Matches(UUID) channelId!: string;
  @IsString() @Length(1, NAME_MAX) name!: string;
}

class TaskResponse {
  @Matches(UUID) taskId!: string;
  @IsString() @Length(1, TITLE_MAX) title!: string;
  @IsIn(STATES) state!: string;
  @IsOptional() @IsInt() @Min(0) effort?: number;
  @IsInt() @Min(1) version!: number;
  @Matches(DATE_TIME) createdAt!: string;
}

type Part = "path" | "query" | "body";
type PipeType = "param" | "query" | "body";
type Metatype = new () => object;

const PIPE_TYPES: Readonly<Record<Part, PipeType>> = {
  path: "param",
  query: "query",
  body: "body",
};
const PARTS: readonly Part[] = ["path", "query", "body"];

const classes: Readonly<Record<string, Partial<Record<Part, Metatype>>>> = {
  health: { query: NoQuery },
  getChannel: { path: ChannelPath, query: NoQuery },
  listTasks: { path: ChannelPath, query: ListTasksQuery },
  createTask: { path: ChannelPath, query: NoQuery, body: CreateTaskBody },
  updateTask: { path: TaskPath, query: NoQuery, body: UpdateTaskBody },
  payments: { query: NoQuery, body: PaymentEventBody },
};

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: false,
  transform: false,
});

/** The issues of a request's path, query and body against the route's classes; none when it is valid. */
export async function validateRouteInput(
  routeId: string,
  parts: Readonly<Record<Part, unknown>>,
): Promise<readonly string[]> {
  const route = Object.hasOwn(classes, routeId) ? classes[routeId] : undefined;

  if (route === undefined)
    throw new Error(`bench: no class-validator classes for route '${routeId}'.`);

  const issues: string[] = [];

  for (const part of PARTS) {
    const metatype = route[part];

    if (metatype !== undefined) issues.push(...(await partIssues(part, metatype, parts[part])));
  }

  return issues;
}

async function partIssues(part: Part, metatype: Metatype, value: unknown): Promise<string[]> {
  try {
    await pipe.transform(value, { type: PIPE_TYPES[part], metatype });

    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;

    const response = error.getResponse();
    const messages =
      typeof response === "object" && response !== null && "message" in response
        ? [response.message].flat().map(String)
        : [error.message];

    return messages.map((message) => `${part}: ${message}`);
  }
}

type ResponseShape = { readonly metatype: Metatype; readonly list: boolean };

const responseShapes: Readonly<Record<string, ResponseShape>> = {
  health: { metatype: HealthResponse, list: false },
  getChannel: { metatype: ChannelResponse, list: false },
  listTasks: { metatype: TaskResponse, list: true },
  createTask: { metatype: TaskResponse, list: false },
  updateTask: { metatype: TaskResponse, list: false },
};

// Transforms to class instances so that `whitelist` drops the members the contract does not declare, as the
// generated runtime's projection does.
const responsePipe = new ValidationPipe({
  whitelist: true,
  forbidUnknownValues: false,
  transform: true,
});

/** The success body of a route checked against its response classes and cut to the declared shape. */
export async function validateRouteOutput(routeId: string, body: unknown): Promise<RouteOutput> {
  const shape = Object.hasOwn(responseShapes, routeId) ? responseShapes[routeId] : undefined;

  if (shape === undefined)
    throw new Error(`bench: no class-validator response classes for route '${routeId}'.`);

  const items = shape.list ? (Array.isArray(body) ? body : [undefined]) : [body];

  try {
    const checked = await Promise.all(
      items.map((item) => responsePipe.transform(item, { type: "body", metatype: shape.metatype })),
    );

    return { issues: [], body: shape.list ? checked : checked[0] };
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;

    return { issues: [`body: ${error.message}`], body };
  }
}
