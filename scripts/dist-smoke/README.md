Channel smoke harness (ADR 0011 "Channel smoke tests"): a loopback npm registry, a loopback HTTPS server and a local bare git repository serving a bundle of the reference contract and a tampered copy, the Node CLI run against each, and `cli.ts serve` for the native legs.

- `node --experimental-transform-types --import ./scripts/ir-models/register.ts scripts/dist-smoke/cli.ts serve [--work <dir>]` starts the three channels and prints their URLs and the bundle's integrity as JSON on one line, then serves until interrupted. Native legs trust the HTTPS server through the printed `caFile`.
- `pnpm vitest run scripts/dist-smoke` runs the smoke tests; they need `npm`, `git` and `openssl` on the PATH.
