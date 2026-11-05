#!/usr/bin/env bash
# Starts the local npm registry of the release rehearsal in the background and registers a throwaway publisher.
# Prints `registry=<url>` and `npmrc=<file>` (the user config holding the publisher's token), for $GITHUB_OUTPUT.
#   scripts/release/start-verdaccio.sh <work-dir>
set -euo pipefail

VERDACCIO_PACKAGE="verdaccio@6.10.7"
PORT=4873
REGISTRY="http://127.0.0.1:${PORT}/"
STARTUP_SECONDS=60

work="${1:?usage: scripts/release/start-verdaccio.sh <work-dir>}"
mkdir -p "$work"
work="$(cd "$work" && pwd)"
cp "$(dirname "$0")/verdaccio.yaml" "$work/config.yaml"

npm exec --yes --package="$VERDACCIO_PACKAGE" -- verdaccio --config "$work/config.yaml" --listen "127.0.0.1:${PORT}" \
  > "$work/verdaccio.log" 2>&1 &
echo "$!" > "$work/verdaccio.pid"

for _ in $(seq "$STARTUP_SECONDS"); do
  if curl --silent --fail "${REGISTRY}-/ping" > /dev/null; then break; fi
  sleep 1
done

if ! curl --silent --fail "${REGISTRY}-/ping" > /dev/null; then
  echo "start-verdaccio: the registry did not answer on ${REGISTRY} within ${STARTUP_SECONDS} s; its log:" >&2
  cat "$work/verdaccio.log" >&2
  exit 1
fi

# A user exists only in this registry's storage, and its token only in this work directory.
password="$(openssl rand -hex 16)"
token="$(curl --silent --fail --request PUT "${REGISTRY}-/user/org.couchdb.user:rehearsal" \
  --header 'content-type: application/json' \
  --data "{\"name\":\"rehearsal\",\"password\":\"${password}\"}" \
  | node -e 'let text = ""; process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => process.stdout.write(JSON.parse(text).token));')"

if [ -z "$token" ]; then
  echo "start-verdaccio: the registry gave the rehearsal publisher no token; its log:" >&2
  cat "$work/verdaccio.log" >&2
  exit 1
fi

printf '//127.0.0.1:%s/:_authToken=%s\n' "$PORT" "$token" > "$work/npmrc"
echo "registry=${REGISTRY}"
echo "npmrc=$work/npmrc"
