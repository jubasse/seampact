#!/usr/bin/env bash
# Reads a failed job's log on stdin and tells whether it failed on a registry or network error rather than on the code:
# prints the first line that names one and exits 0, or prints nothing and exits 1. The signatures are those of a
# refused or unreachable registry (a 403, a 429 or a 5xx, a repository Gradle disabled, a timed out or reset
# connection) as Gradle, Maven, npm, pnpm, uv, pip and Composer report them.
#   registry-failure.sh < job.log
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "usage: registry-failure.sh < job.log" >&2
  exit 2
fi

registry_failure_signatures=(
  # Gradle "Received status code 429 from server", Maven "status code: 429".
  'status code:? (403|429|5[0-9]{2})'
  # Composer, curl and uv print the status line.
  'HTTP/[0-9.]+ (403|429|5[0-9]{2})'
  'Too Many Requests'
  'Service Unavailable'
  'Bad Gateway'
  'Gateway Time-?out'
  # Gradle, once a repository failed: "Could not resolve org.example:module:1.0", "Repository MavenRepo is disabled".
  'Could not resolve'
  'Repository [^ ]+ is disabled'
  # Maven Resolver.
  'Could not transfer artifact'
  # npm "npm error code E429" and pnpm "ERR_PNPM_FETCH_429".
  'code E(403|429|5[0-9]{2})'
  'ERR_PNPM_FETCH_(403|429|5[0-9]{2})'
  'ERR_PNPM_META_FETCH_FAIL'
  'ETIMEDOUT'
  'ECONNRESET'
  'Read timed out'
)

pattern="$(IFS='|'; echo "${registry_failure_signatures[*]}")"

# grep -m 1 stops reading at the first match; the rest of the log is drained so the writer gets no broken pipe.
if matched_line="$(grep -E -m 1 -- "$pattern")"; then
  cat >/dev/null
  printf '%s\n' "$matched_line"
  exit 0
fi

exit 1
