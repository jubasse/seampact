// The commands the CLI runs today, `compile`, `generate`, `check`, `lint` and `diff`, and the steps between the app config and the target
// packages: the sources compiled, the IR filtered per entry, the link checks and the link set.

export { checkCommand } from "./check-command.js";
export { compileCommand } from "./compile-command.js";
export { type ConfigLocation, configLocation } from "./config-location.js";
export { diffCommand } from "./diff-command.js";
export { generateCommand } from "./generate-command.js";
export { lintCommand } from "./lint-command.js";
