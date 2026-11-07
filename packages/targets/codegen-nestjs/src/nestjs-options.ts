import type { ParseOptionsOutcome, Refusal } from "@seampact/codegen-core";
import { type NodeServerOptions, parseNodeServerOptions } from "@seampact/codegen-core/node-server";

// The NestJS target's options (ADR 0016 "Target options"): those of every Node server target, and `reply`, who writes
// a contract route's reply after step 10: the handler wrapper (`handler`, the default) or the seampact reply
// interceptor (`interceptor`), which lets the app's interceptors map the result first.

const REPLY_MODES = ["handler", "interceptor"] as const;
const REPLY_KEY = "reply";

export type ReplyMode = (typeof REPLY_MODES)[number];

export const DEFAULT_REPLY_MODE: ReplyMode = "handler";

export interface NestjsOptions extends NodeServerOptions {
  reply: ReplyMode;
}

/** Accepts the Node server options and `reply: handler | interceptor`; any other key or value is refused. */
export function parseNestjsOptions(raw: unknown): ParseOptionsOutcome<NestjsOptions> {
  const parsed = parseNodeServerOptions(raw, { compression: false, targetKeys: [REPLY_KEY] });
  const reply = replyOptionOf(raw);
  const refusals: Refusal[] = [
    ...(parsed.status === "refused" ? parsed.refusals : []),
    ...(isReplyMode(reply) ? [] : [invalidReplyRefusal(reply)]),
  ];

  if (parsed.status === "refused" || !isReplyMode(reply)) return { status: "refused", refusals };

  return { status: "parsed", options: { ...parsed.options, reply } };
}

/** The raw options without `reply`, for the Node server target that parses the rest. */
export function withoutReplyOption(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;

  return Object.fromEntries(Object.entries(raw).filter(([key]) => key !== REPLY_KEY));
}

function replyOptionOf(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Object.hasOwn(raw, REPLY_KEY)) {
    return DEFAULT_REPLY_MODE;
  }

  return Object.getOwnPropertyDescriptor(raw, REPLY_KEY)?.value;
}

function isReplyMode(value: unknown): value is ReplyMode {
  return REPLY_MODES.some((mode) => mode === value);
}

function invalidReplyRefusal(reply: unknown): Refusal {
  return {
    code: "options.reply.invalid",
    message: `The option 'reply' is ${JSON.stringify(reply)}, not one of ${REPLY_MODES.join(", ")}.`,
    fix: "Set 'reply' to 'handler' (the default) or 'interceptor', which lets the app's interceptors map the result before seampact checks and writes it.",
    member: `/${REPLY_KEY}`,
  };
}
