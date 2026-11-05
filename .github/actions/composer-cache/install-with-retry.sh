#!/usr/bin/env bash
# Runs `composer install` with the given arguments; reruns it once when the first run failed on a network error.
# Any other failure (resolution, advisory block, lock mismatch) fails at once.

NETWORK_ERROR_PATTERN='curl error (6|7|28|35)\b|Connection timed out'

composer_output_is_network_error() {
  grep -Eq "$NETWORK_ERROR_PATTERN"
}

composer_install_with_retry() {
  local output_file status trigger
  output_file=$(mktemp)

  composer install "$@" 2>&1 | tee "$output_file"
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
  echo "Retrying composer install once after a network error (${trigger})."

  composer install "$@"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  composer_install_with_retry "$@"
fi
