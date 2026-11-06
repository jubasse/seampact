#!/usr/bin/env bash
# The base branch whose pull requests run the fast tier: their lane paths are the pull-request paths and they hold no
# queue rows. Sourced by lane-paths.sh and row-classes.sh, so both read one value.
# shellcheck disable=SC2034
fast_tier_base=develop
