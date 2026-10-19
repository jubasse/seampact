// Runs the hand-written profile of the shared HTTP suite (CHK-098): the hooks are the template's scripted doubles,
// and no adapter or authorization library is installed, which the manifest check below holds.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CONSUMER_ROOT, describeHttpProfile } from "./suite-run.mjs";

// The adapters of ADR 0009, by the end of their package name, and the authorization libraries they wrap.
const ADAPTER_IDS = ["nestjs-casl", "laravel-spatie"];
const AUTHORIZATION_PACKAGES = [/^@casl\//, /casbin/, /^accesscontrol$/];

describeHttpProfile("hand-written");

test("the consumer installs no adapter or authorization library", () => {
  const manifest: { dependencies?: object; devDependencies?: object } = JSON.parse(
    readFileSync(join(CONSUMER_ROOT, "package.json"), "utf8"),
  );
  const installed = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];

  expect(
    installed.filter(
      (name) =>
        ADAPTER_IDS.some((id) => name.endsWith(id)) ||
        AUTHORIZATION_PACKAGES.some((rule) => rule.test(name)),
    ),
  ).toEqual([]);
});
