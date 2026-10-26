import { isAbsolute, relative, resolve, sep } from "node:path";
import { APP_CONFIG_FILE_NAME } from "@seampact/spec/config";

// The app config file a command reads, and the path its problems print.
export interface ConfigLocation {
  file: string;
  displayName: string;
  // The file whose text is read as `file`, when the config is written elsewhere (`--app-directory`): a build file's
  // config handed over by its plugin. Paths still resolve against `file`'s directory.
  textFile?: string;
}

// `--config` resolved against the working directory, `seampact.config.yaml` there when absent.
export function configLocation(cwd: string, configOption: string | undefined): ConfigLocation {
  const file = resolve(cwd, configOption ?? APP_CONFIG_FILE_NAME);

  return { file, displayName: displayPath(cwd, file) };
}

// Relative to the working directory when the file is inside it, absolute otherwise. A relative path prints with
// forward slashes on every platform, the form a config file writes.
export function displayPath(cwd: string, file: string): string {
  const fromCwd = relative(cwd, file);
  const isInsideCwd =
    fromCwd !== "" && !isAbsolute(fromCwd) && fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`);

  return isInsideCwd ? fromCwd.split(sep).join("/") : file;
}
