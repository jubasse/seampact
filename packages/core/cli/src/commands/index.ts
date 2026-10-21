// The commands the CLI runs, `compile`, `generate`, `check`, `lint`, `diff`, `bundle` and `explain`, and the steps between the app config and the target
// packages: the sources compiled, the IR filtered per entry, the link checks and the link set.

export { type BundleCommandOptions, bundleCommand } from "./bundle-command.js";
export { checkCommand } from "./check-command.js";
export { compileCommand } from "./compile-command.js";
export { type ConfigLocation, configLocation } from "./config-location.js";
export { diffCommand } from "./diff-command.js";
export { generateCommand } from "./generate-command.js";
export { lintCommand } from "./lint-command.js";
