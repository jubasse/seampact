import { describe, expect, it } from "vitest";
import { ReleaseError } from "../release-version.ts";
import { consumerRepositories, withReleasedRequirements } from "./composer-registry.ts";
import {
  registrySettings,
  seampactPackagesOffVersion,
  withPublishedPackages,
} from "./node-consumer.ts";

describe("the Node consumer of the registry proof", () => {
  it("adds each published package at exactly the release version beside the consumer's own dependencies", () => {
    const manifest = {
      name: "test-seampact-consumer",
      dependencies: { zod: "4.6.7", "@seampact/cli": "file:./vendor/seampact/cli.tgz" },
    };

    expect(
      withPublishedPackages(manifest, ["@seampact/cli", "@seampact/http-suite"], "1.0.0"),
    ).toEqual({
      name: "test-seampact-consumer",
      dependencies: { zod: "4.6.7", "@seampact/cli": "1.0.0", "@seampact/http-suite": "1.0.0" },
    });
  });

  it("sends every install to the registry given, and refuses one that is not http or https", () => {
    expect(registrySettings("http://127.0.0.1:4873/")).toBe("registry=http://127.0.0.1:4873/\n");
    expect(registrySettings("https://registry.npmjs.org")).toBe(
      "registry=https://registry.npmjs.org/\n",
    );
    expect(() => registrySettings("file:///tmp/registry")).toThrow(ReleaseError);
  });
});

describe("the installed versions of the Node consumer", () => {
  it("names each @seampact/* package at any depth whose version is not the release", () => {
    const listing = [
      {
        name: "test-seampact-consumer",
        dependencies: {
          "@seampact/cli": {
            version: "1.0.0",
            dependencies: {
              "@seampact/compiler": { version: "1.0.1" },
              yaml: { version: "2.9.1" },
            },
          },
          zod: { version: "4.6.7" },
        },
        devDependencies: { "@seampact/http-suite": { version: "1.0.0" } },
        optionalDependencies: { "@seampact/spec": {} },
      },
    ];

    expect(seampactPackagesOffVersion(listing, "1.0.0")).toEqual([
      "@seampact/compiler@1.0.1",
      "@seampact/spec@undefined",
    ]);
    expect(seampactPackagesOffVersion(listing, "1.0.1")).toEqual([
      "@seampact/cli@1.0.0",
      "@seampact/http-suite@1.0.0",
      "@seampact/spec@undefined",
    ]);
  });
});

describe("the PHP consumer of the registry proof", () => {
  const manifest = {
    name: "seampact/laravel-consumer",
    require: {
      php: ">=8.3.36",
      "laravel/framework": "~13.38.0",
      "seampact/consumer-suite": "dev-develop",
      "seampact/laravel": "dev-develop",
    },
  };

  it("requires each seampact package at the release version but the unpublished suite doubles", () => {
    expect(withReleasedRequirements(manifest, "1.0.0").require).toEqual({
      php: ">=8.3.36",
      "laravel/framework": "~13.38.0",
      "seampact/consumer-suite": "dev-develop",
      "seampact/laravel": "1.0.0",
    });
    expect(() => withReleasedRequirements({ name: "no-require" }, "1.0.0")).toThrow(ReleaseError);
  });

  it("takes the suite doubles by path and the released packages from the mirrors only, or from Packagist", () => {
    const suite = {
      type: "path",
      url: "/work/consumer-suite",
      options: { symlink: false, versions: { "seampact/consumer-suite": "dev-develop" } },
    };

    expect(consumerRepositories("/work/consumer-suite", { kind: "packagist" })).toEqual([suite]);
    expect(
      consumerRepositories("/work/consumer-suite", {
        kind: "mirrors",
        mirrorUrls: ["/mirrors/seampact-hooks.git"],
      }),
    ).toEqual([
      suite,
      { type: "vcs", url: "/mirrors/seampact-hooks.git" },
      { type: "composer", url: "https://repo.packagist.org", exclude: ["seampact/*"] },
      { "packagist.org": false },
    ]);
  });
});
