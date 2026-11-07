#!/usr/bin/env bash
# Reads a failed job's log on stdin and tells whether it failed on a registry or network error rather than on the code:
# prints the first line that names one and exits 0, or prints nothing and exits 1. The signatures are those of a
# refused or unreachable registry (a 403, a 429 or a 5xx, a timed out or reset connection) as Gradle, Maven, npm, pnpm,
# uv, pip and Composer report them. A line counts only when it names a registry host or a Gradle or Maven coordinate,
# so a failure of the code under test (an http-suite 503, a connection to localhost, a bundler's unresolved import) is
# never taken for a registry outage; a line that names a loopback address never counts.
#   registry-failure.sh < job.log
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "usage: registry-failure.sh < job.log" >&2
  exit 2
fi

registry_hosts='(repo\.maven\.apache\.org|repo1\.maven\.org|central\.sonatype\.com|plugins\.gradle\.org|services\.gradle\.org|registry\.npmjs\.org|pypi\.org|files\.pythonhosted\.org|repo\.packagist\.org|api\.github\.com|objects\.githubusercontent\.com)'

# What a refused or unreachable registry looks like, on the line that names its host.
failure_wordings='(status code:? (403|429|5[0-9][0-9])|HTTP/[0-9.]+ (403|429|5[0-9][0-9])|Too Many Requests|Service Unavailable|Bad Gateway|Gateway Time-?out|code E(403|429|5[0-9][0-9])|ERR_PNPM_(META_)?FETCH_[A-Z_0-9]+|ETIMEDOUT|ECONNRESET|Read timed out)'

# Gradle "Could not resolve org.example:module:1.0" and Maven Resolver "Could not transfer artifact org.example:module:pom:1.0".
coordinate_failures='(Could not resolve|Could not transfer artifact) [A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+'

loopback='(127\.[0-9]+\.[0-9]+\.[0-9]+|localhost|\[?::1\]?([^0-9a-f]|$))'

# The whole log is read, so the writer gets no broken pipe; the first matching line is printed.
# The patterns pass through the environment, since awk -v would read their backslashes as escapes.
export registry_hosts failure_wordings coordinate_failures loopback

awk '
  BEGIN {
    hosts = ENVIRON["registry_hosts"]; wordings = ENVIRON["failure_wordings"]
    coordinates = ENVIRON["coordinate_failures"]; loopback = ENVIRON["loopback"]
  }
  !found && $0 !~ loopback && (($0 ~ hosts && $0 ~ wordings) || $0 ~ coordinates) { print; found = 1 }
  END { exit found ? 0 : 1 }
'
