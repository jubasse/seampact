// The `code` Node gives its errors (`ENOENT`, `MODULE_NOT_FOUND`, `ERR_PARSE_ARGS_UNKNOWN_OPTION`), or undefined.
export function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
