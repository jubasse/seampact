#!/bin/sh
# Generates and checks a Python target from the local YAML of the reference contract through the pinned compiler
# binary, with no bundle: `local-yaml.sh <work> <venv> <binary> <distribution>` makes the project <work>/<name> (the
# distribution name less `seampact-`) whose root `pyproject.toml` pins <binary> by path and hash, whose config names
# the contract directory as a `path` source and the tasks api of <distribution> with no `openapi` key, so the binary
# also writes the api's default documents. It then runs `seampact generate` and `seampact check` of the virtual
# environment <venv>, and expects generated Python and an OpenAPI document. Nothing here starts Node.
set -eu

work="$1"
venv="$2"
binary=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
distribution="$4"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
app="$work/${distribution#seampact-}"

if [ -e "$app" ]; then
  echo "local-yaml.sh: $app exists; give a new work directory." >&2
  exit 1
fi

mkdir -p "$app"
cp -R "$repo/fixtures/reference" "$app/contract"
sha256=$(sha256sum "$binary" | cut -d " " -f 1)
printf '[project]\nname = "seampact-local-yaml"\nversion = "0"\n\n[tool.seampact.binary]\npath = "%s"\nsha256 = "%s"\n' \
  "$binary" "$sha256" > "$app/pyproject.toml"
cat > "$app/seampact.config.yaml" <<YAML
outDir: generated
sources:
  contract: { path: contract }
targets:
  - id: tasks
    out: tasks
    use: pypi:$distribution
    api: tasks
YAML

cd "$app"
"$venv/bin/seampact" generate
"$venv/bin/seampact" check

if [ -z "$(find generated -name '*.py' | head -n 1)" ]; then
  echo "local-yaml.sh: $distribution generated no Python file." >&2
  exit 1
fi
if [ -z "$(find openapi -name '*.yaml' 2>/dev/null | head -n 1)" ]; then
  echo "local-yaml.sh: the binary wrote no OpenAPI document." >&2
  exit 1
fi
echo "$distribution: generated and checked from the local YAML, documents included."
