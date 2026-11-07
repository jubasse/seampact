// The reply mode the consumer's server entry was generated with: `interceptor` when the consumers CLI wrote the
// target option `reply: interceptor` into its config, else the default `handler`.
import { readFileSync } from "node:fs";

const CONFIG_FILE = new URL("../seampact.config.yaml", import.meta.url);
const INTERCEPTOR_REPLY_OPTION = /^\s+reply:\s*interceptor\s*$/m;

export const REPLY_MODE: "handler" | "interceptor" = INTERCEPTOR_REPLY_OPTION.test(
  readFileSync(CONFIG_FILE, "utf8"),
)
  ? "interceptor"
  : "handler";
