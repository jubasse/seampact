// The command line of the bundle signing (`bundle-signatures.ts`) publish-maven-central runs after the approval, and
// the rehearsal with a throwaway key: it signs the unsigned bundle build-jvm checked, exactly the files of its
// manifest, then writes the manifest of the signed bundle the publish takes. The key comes from the environment,
// `SIGNING_KEY` (ASCII-armoured secret key) and `SIGNING_KEY_PASSWORD` (empty or unset without a passphrase).
//   node scripts/release/jvm/sign-bundle.ts <dir> --manifest <file> --signed-manifest <out-file>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError } from "../release-version.ts";
import { parsedBundleManifest } from "./bundle-manifest.ts";
import { signBundle } from "./bundle-signatures.ts";

const USAGE = "sign-bundle.ts <dir> --manifest <file> --signed-manifest <out-file>";

if (import.meta.main)
  await runReleaseCommand("sign-bundle", () => {
    const { values, positionals } = parsedArguments(
      { manifest: { type: "string" }, "signed-manifest": { type: "string" } },
      USAGE,
    );
    const [directory] = positionals;
    const signedManifestFile = values["signed-manifest"];

    if (
      directory === undefined ||
      values.manifest === undefined ||
      signedManifestFile === undefined
    )
      throw new ReleaseError(`usage: ${USAGE}`);

    const secretKey = process.env.SIGNING_KEY ?? "";

    if (secretKey === "")
      throw new ReleaseError(
        "SIGNING_KEY is not set: the bundle is signed with the release key of the release environment",
      );

    const manifest = parsedBundleManifest(readFileSync(values.manifest, "utf8"), values.manifest);
    const signedManifest = signBundle(resolve(directory), manifest, {
      secretKey,
      passphrase: process.env.SIGNING_KEY_PASSWORD ?? "",
    });

    writeFileSync(signedManifestFile, `${JSON.stringify(signedManifest)}\n`);
    console.log(
      `sign-bundle: ${signedManifest.length - manifest.length} files of ${directory} signed, the signed manifest in ${signedManifestFile}`,
    );
  });
