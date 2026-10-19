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
