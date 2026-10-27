import type { Target } from "@seampact/codegen-core";
import { nodeServerTarget } from "@seampact/codegen-core/node-server";
import { serverTargetCompatibility } from "@seampact/spec/compatibility";
import { format } from "prettier";
import packageJson from "../package.json" with { type: "json" };
import { nestjsDocsModuleSource } from "./nestjs-docs-module.js";
import { nestjsModuleSource } from "./nestjs-module.js";
import {
  DEFAULT_REPLY_MODE,
  parseNestjsOptions,
  type ReplyMode,
  withoutReplyOption,
} from "./nestjs-options.js";

// The NestJS target, as the CLI loads it. Its placement is the `nestjs` module of each api, over the NestJS placement
// of `@seampact/server-runtime`. It reads the validator
// styles the compatibility matrix records for it, Standard Schema and class-validator. Its own option `reply` picks
// the Node server target whose `nestjs` module passes that reply mode to the boundary.
function nestjsTargetOf(reply: ReplyMode): Target {
  return nodeServerTarget({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    format,
    placement: {
      frameworkModule: "nestjs",
      frameworkSource: (ir, options, refusals, docsModule) =>
        nestjsModuleSource(ir, { ...options, reply }, refusals, docsModule),
      nativeDocs: { docsModule: "nestjs-docs", docsSource: nestjsDocsModuleSource },
      handlerParameters: "inputThenDecorated",
    },
    validatorStyles: serverTargetCompatibility(packageJson.name).validatorStyles,
    frameworkDocsOffFix: "remove the `SwaggerModule.setup` call",
  });
}

const TARGETS_BY_REPLY_MODE: Readonly<Record<ReplyMode, Target>> = {
  handler: nestjsTargetOf("handler"),
  interceptor: nestjsTargetOf("interceptor"),
};

export const target: Target = {
  metadata: TARGETS_BY_REPLY_MODE[DEFAULT_REPLY_MODE].metadata,
  parseOptions: parseNestjsOptions,
  generate: async (request) => {
    const parsed = parseNestjsOptions(request.options);

    if (parsed.status === "refused") return parsed;

    return TARGETS_BY_REPLY_MODE[parsed.options.reply].generate({
      ...request,
      options: withoutReplyOption(request.options),
    });
  },
  describe: (ir, rawOptions) => {
    const parsed = parseNestjsOptions(rawOptions);

    if (parsed.status === "refused") return parsed;

    return TARGETS_BY_REPLY_MODE[parsed.options.reply].describe(ir, withoutReplyOption(rawOptions));
  },
};
