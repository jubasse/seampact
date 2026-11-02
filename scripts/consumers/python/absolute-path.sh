# Sourced by the scripts of this directory: `absolute_path <path>` prints <path> made absolute from the current
# directory, so that a later `cd` cannot change what it names. The path need not exist.
absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd -P)" "$1" ;;
  esac
}
