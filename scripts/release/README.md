Release scripts of `release.yml`: the version stamp and its check, the npm packing and its content check, the idempotent npm publish, and the check of the binaries against `SHA256SUMS`.

- `node scripts/release/stamp.ts <version>` writes the version into every `package.json` (dropping `private` from the published packages), `jvm/gradle.properties`, every `python/*/pyproject.toml` (each requirement on another seampact distribution pinned `==<version>`) and `python/uv.lock`. Run it once on the release branch and commit the result.
- `node scripts/release/check-version.ts <version>` fails, naming each field, when the checkout is not at the version.
