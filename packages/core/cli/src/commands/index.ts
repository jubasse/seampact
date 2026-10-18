// The commands the CLI runs today, `compile` and `generate`, and the steps between the app config and the target
// packages: the sources compiled, the IR filtered per entry, the link checks and the link set.

export { compileCommand } from "./compile-command.js";
export { type ConfigLocation, configLocation } from "./config-location.js";
export { generateCommand } from "./generate-command.js";
