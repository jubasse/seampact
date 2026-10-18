// The app config as the CLI reads it: the YAML reader and its refusals, and the target packages it names,
// resolved from the app's own project.

export { type AppConfigEntry, type LoadedAppConfig, readAppConfig } from "./read-app-config.js";
export { resolveTarget } from "./resolve-target.js";
