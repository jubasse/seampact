Local benchmark harness: each seampact server of the compatibility matrix against the same routes hand-written on the bare framework, and a profile of where the boundary spends its time.

Run it on your machine; nothing here is a CI job and results are never committed (`.bench-output/` is git-ignored).

```
node scripts/bench/cli.ts --all --check                      # parity probe on every pair, no load
node scripts/bench/cli.ts --target nestjs --validators zod   # all routes of one pair, results under .bench-output/latest
node scripts/bench/cli.ts --target express4 --validators yup --route getChannel,payments --duration 3 --repeats 2
node scripts/bench/cli.ts --target express --validators zod --profile --route listTasks
node scripts/bench/cli.ts --target nestjs --validators zod --compare before/results.json
```

How a pair runs:

- The pairs come from `offeredValidatorPairs()` of `@seampact/spec/compatibility`; a target's highest framework major runs on its own consumer overlay (`express`), another major on `express4` or `adonis6`. A new pair needs its baseline validator file in `project/baselines/validators/<id>.mts` and nothing else.
- `scripts/consumers` assembles one project per pair in `--work` (default the system temp directory) from the packed packages, with `autocannon` and `tsx` added to that project only. `--reuse` keeps an earlier project of the same commit and takes only the `project/` sources again; it does not rebuild the packages.
- Two servers start in forked children of the project: the generated one (the consumer's `test/server.mts`) and the baseline (`project/baselines/<framework>/server.mts`). The baseline's framework does routing, body parsing and the reply; `baselines/route-work.mts` does the rest with the consumer's own hooks and handlers, so only the boundary differs: bearer lookup or the signature check, schema validation, scope resolution, deciders, the idempotency claim.
- The parity probe (`project/load-driver.mts probe`) sends each route's valid request, an unknown-key request and a request without credentials to both servers: same status and body, and both refuse alike. A pair that differs stops there.
- Each route runs 3 times per server, alternating, at saturation (10 connections, pipelining 1, a discarded warm-up then the measured run), then 3 times at 70% of the baseline's saturation rate for p50 and p99 at equal load. A run with any non-2xx answer, error or timeout is invalid and fails the run.
- Peak RSS and heap come from the server child (sampled every 250 ms, reset before each run); the machine's load average is recorded beside every run, since runs on a shared machine are not comparable across load.

`--profile` runs the generated server under the V8 sampling profiler for one route and folds the samples into the steps of ADR 0012 "The check order" with `boundary-steps.ts`, the one map from the runtime's function names to steps. Steps 3 and 8 have no runtime code (the generator refuses them until a contract needs them); the idempotency claim and the glue that runs the steps in order get rows of their own.
