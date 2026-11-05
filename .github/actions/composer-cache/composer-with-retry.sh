#!/usr/bin/env bash
# Runs `composer <install|update> <arguments>`; reruns it once when the first run failed on a network error.
# Any other failure (resolution, advisory block, lock mismatch) fails at once.

# curl: resolve, connect, partial transfer, timeout, TLS connect, empty reply, receive; a 5xx answer from a host.
NETWORK_ERROR_PATTERN='curl error (6|7|18|28|35|52|56)\b|Connection timed out|could not be downloaded \(HTTP/[0-9.]+ 5[0-9][0-9]'

composer_output_is_network_error() {
  grep -Eq "$NETWORK_ERROR_PATTERN"
}

composer_with_retry() {
  local output_file status trigger
  output_file=$(mktemp)

  composer "$@" 2>&1 | tee "$output_file"
  status=${PIPESTATUS[0]}

  if [ "$status" -eq 0 ]; then
    rm -f "$output_file"
    return 0
  fi

  if ! composer_output_is_network_error < "$output_file"; then
    rm -f "$output_file"
    return "$status"
  fi

  trigger=$(grep -Eo "$NETWORK_ERROR_PATTERN" "$output_file" | head -n 1)
  rm -f "$output_file"
  echo "Retrying composer ${1} once after a network error (${trigger})."

  composer "$@"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  composer_with_retry "$@"
fi
