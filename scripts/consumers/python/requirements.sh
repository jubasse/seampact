#!/bin/sh
# Writes a Python consumer's third-party requirements, every file pinned by hash, from the workspace lock
# `python/uv.lock` (ADR 0011 "Unpublished installs for test consumers"): `requirements.sh <out> <distribution> <extra>
# <server>` lists what <distribution> with its <extra> needs, without the seampact distributions, then the server
# package <server> of the lock's serve group with what it needs. <out> is new.
set -eu

out="$1"
distribution="$2"
extra="$3"
server="$4"
here=$(cd "$(dirname "$0")" && pwd)
workspace=$(cd "$here/../../../python" && pwd)

if [ -e "$out" ]; then
  echo "requirements.sh: $out exists; give a new file." >&2
  exit 1
fi

cd "$workspace"
uv export --frozen --no-emit-workspace --no-dev --no-header --no-annotate \
  --package "$distribution" --extra "$extra" > "$out"

# The server's own closure, as the lock resolves it, less what the distribution already brought.
# `uv tree` prints each root of the group unindented, its dependencies below it indented.
server_names=$(uv tree --frozen --only-group serve --no-dedupe |
  awk -v root="$server" '/^[a-zA-Z0-9]/ { inside = ($1 == root) } inside' |
  sed -e 's/^[^a-zA-Z0-9]*//' -e 's/ .*//' | sort -u)
listed_names=$(sed -n 's/^\([A-Za-z0-9._-]*\)==.*/\1/p' "$out")

if [ -z "$server_names" ]; then
  echo "requirements.sh: the serve group of the lock has no package '$server'." >&2
  exit 1
fi

uv export --frozen --no-emit-workspace --only-group serve --no-header --no-annotate |
  awk -v wanted="$server_names" -v listed="$listed_names" '
    BEGIN {
      split(wanted, names, "\n"); for (i in names) keep[names[i]] = 1
      split(listed, names, "\n"); for (i in names) delete keep[names[i]]
    }
    /^[^ ]/ { name = $0; sub(/[=; ].*/, "", name); printing = (name in keep); if (printing) found[name] = 1 }
    printing { print }
    END { for (name in keep) if (!(name in found)) { print "requirements.sh: no hashed entry for " name > "/dev/stderr"; exit 1 } }
  ' >> "$out"
