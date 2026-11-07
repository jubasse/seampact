# Signed webhook errors

Codes that start with `signature.`. The signed webhook helpers (npm, PHP, Java) throw them when your code passes a signature template they cannot verify safely. (A signature template is the `signature` of a hook in your contract: its payload, algorithm and tolerance.) They name the same cases on every stack.

| Code | Cause and fix |
|---|---|
| `signature.payload.invalid` | The signed payload template must hold `{rawBody}` exactly once and `{ts}` at most once. Pass the payload of the hook's signature template. |
| `signature.tolerance.invalid` | A payload with `{ts}` needs a tolerance, a whole number of milliseconds of at least 0; a payload without `{ts}` takes none. Pass the tolerance of the hook's signature template. |
| `signature.algorithm.unsupported` | The helper only computes the algorithm its message names. Verify this scheme in your own code (`verify: application` in the contract: your application checks the signature itself), or update the helper. |

Next: [Access, error code and throttle errors](access-and-errors.md).
