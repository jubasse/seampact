// The command line of the bundle signing (`bundle-signatures.ts`) publish-maven-central runs after the approval, and
// the rehearsal with a throwaway key: it signs the unsigned bundle build-jvm checked, exactly the files of its
// manifest, then writes the manifest of the signed bundle the publish takes. The key comes from the environment,
// `SIGNING_KEY` (ASCII-armoured secret key) and `SIGNING_KEY_PASSWORD` (empty or unset without a passphrase). With
// `--keyserver`, a real run's, it first checks that the keyserver serves the release public key.
//   node scripts/release/jvm/sign-bundle.ts <dir> --manifest <file> --signed-manifest <out-file> [--keyserver <url>]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError } from "../release-version.ts";
import { parsedBundleManifest } from "./bundle-manifest.ts";
import { checkReleaseKeyOnKeyserver, signBundle } from "./bundle-signatures.ts";

const USAGE =
  "sign-bundle.ts <dir> --manifest <file> --signed-manifest <out-file> [--keyserver <url>]";

if (import.meta.main)
  await runReleaseCommand("sign-bundle", async () => {
    const { values, positionals } = parsedArguments(
      {
        manifest: { type: "string" },
        "signed-manifest": { type: "string" },
        keyserver: { type: "string" },
      },
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

    if (values.keyserver !== undefined)
      await checkReleaseKeyOnKeyserver(secretKey, values.keyserver);

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
