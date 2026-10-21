import apiPlatformManifest from "@seampact/pack-api-platform/package.json" with { type: "json" };
import apiPlatformPack from "@seampact/pack-api-platform/pack.yaml";
import crudRightsManifest from "@seampact/pack-crud-rights/package.json" with { type: "json" };
import crudRightsPack from "@seampact/pack-crud-rights/pack.yaml";
import halManifest from "@seampact/pack-hal/package.json" with { type: "json" };
import halPack from "@seampact/pack-hal/pack.yaml";
import jsonapiManifest from "@seampact/pack-jsonapi/package.json" with { type: "json" };
import jsonapiPack from "@seampact/pack-jsonapi/pack.yaml";
import laravelManifest from "@seampact/pack-laravel/package.json" with { type: "json" };
import laravelPack from "@seampact/pack-laravel/pack.yaml";
import springManifest from "@seampact/pack-spring/package.json" with { type: "json" };
import springPack from "@seampact/pack-spring/pack.yaml";
import type { EmbeddedPackage } from "./embedded-pack-reader.js";

const PACK_FILE_NAME = "pack.yaml";

function embeddedPackage(
  name: string,
  manifest: Readonly<Record<string, unknown>>,
  packText: string,
): EmbeddedPackage {
  return {
    name,
    files: { "package.json": JSON.stringify(manifest), [PACK_FILE_NAME]: packText },
  };
}

// The first-party packs the binary carries, so a contract naming one resolves with no `node_modules` (ADR 0008).
export const EMBEDDED_PACKS: readonly EmbeddedPackage[] = [
  embeddedPackage("@seampact/pack-api-platform", apiPlatformManifest, apiPlatformPack),
  embeddedPackage("@seampact/pack-crud-rights", crudRightsManifest, crudRightsPack),
  embeddedPackage("@seampact/pack-hal", halManifest, halPack),
  embeddedPackage("@seampact/pack-jsonapi", jsonapiManifest, jsonapiPack),
  embeddedPackage("@seampact/pack-laravel", laravelManifest, laravelPack),
  embeddedPackage("@seampact/pack-spring", springManifest, springPack),
];
