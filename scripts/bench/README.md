Local benchmark harness: each seampact server of the compatibility matrix against the same routes hand-written on the bare framework, and a profile of where the boundary spends its time.

Run it on your machine; nothing here is a CI job and results are never committed (`.bench-output/` is git-ignored).

```
node scripts/bench/cli.ts --all --check                      # parity probe on every pair, no load
node scripts/bench/cli.ts --all                              # quick run of the whole matrix, pairs in parallel
node scripts/bench/cli.ts --target nestjs --validators zod   # all routes of one pair, results under .bench-output/latest
node scripts/bench/cli.ts --target express4 --validators yup --route getChannel,payments --duration 3 --repeats 2
node scripts/bench/cli.ts --target nestjs --validators zod --thorough   # 10 s runs, latency at a fixed rate, body-off rows
node scripts/bench/cli.ts --target express --validators zod --profile --route listTasks
node scripts/bench/cli.ts --target nestjs --validators zod --compare before/results.json
```

Quick by default: a 1 s discarded warm-up and a 4 s measured run per server and route, 3 repeats alternating, saturation only. `--latency` adds the fixed-rate runs (p50 and p99 at equal load), `--body-off` adds the rows with the outgoing body check off, `--thorough` is both with the long settings (10 s runs, 3 s warm-up). `--all` runs `--parallel <n>` pairs at once (default: cores / 3, rounded down); each pair is pinned with `taskset` to two cores of its own, its servers on one and its load driver on the other, while a pair's two servers still alternate on the same cores so the ratio stays fair. Without `taskset`, `--parallel` above 1 is refused: install util-linux or run `--parallel 1`. Ratios from a loaded machine are indicative; absolute numbers across runs are not comparable.

How a pair runs:

- The pairs come from `offeredValidatorPairs()` of `@seampact/spec/compatibility`; a target's highest framework major runs on its own consumer overlay (`express`), another major on `express4` or `adonis6`. A new pair needs its baseline validator file in `project/baselines/validators/<id>.mts` and nothing else.
- `scripts/consumers` assembles one project per pair in `--work` (default the system temp directory) from the packed packages, with `autocannon` and `tsx` added to that project only. The assembled project is cached under `--work` per commit, target and validator and reused (only the `project/` sources are copied again) when up to date; it is rebuilt when the commit moved, when `packages/` has uncommitted changes, or with `--fresh`.
- Two servers start in forked children of the project: the generated one (the consumer's `test/server.mts`) and the baseline (`project/baselines/<framework>/server.mts`). The baseline's framework does routing, body parsing and the reply; `baselines/route-work.mts` does the rest with the consumer's own hooks and handlers, so only the boundary differs: bearer lookup or the signature check, schema validation, scope resolution, deciders, the idempotency claim, then the reply checked against its response schema and cut to the declared shape (what the generated route does with `bodyValidation` on). The generated app mounts both apis' operations and the baseline the six measured routes, so the router match cost differs a little, as it does in a real app.
- The parity probe (`project/probe.mts`) sends each route's valid request (same status, body and `link`, `cache-control`, `content-type`), an unknown-key request and a request without credentials to both servers, then what proves each boundary step runs: the throttled user the decider denies, the same idempotency key twice (a replay) and with another body (a refused reuse), a bad signature. A baseline that skips a step differs there and the pair stops; `probe.test.ts` shows each skipped step failing.
- The consumer config turns `bodyValidation` on, so `--body-off` (and `--thorough`) measure each pair twice: `hono-zod` and `hono-zod-body-off`, the same project assembled with the outgoing body check off.
- Each route runs 3 times per server, alternating, at saturation (10 connections, pipelining 1, a discarded warm-up then the measured run); with `--latency`, then 3 times at 70% of the lower of the two saturation rates for p50 and p99 at equal load; a run where either server's achieved rate falls more than 5% short of the rate sent is shown as invalid, since it is not at equal load. A run with any non-2xx answer, error or timeout is invalid and fails the run.
- Peak RSS and heap come from the server child (sampled every 250 ms, reset before each run, so a route's peak includes the growth of the routes run before it); the machine's load average is recorded beside every run, since runs on a shared machine are not comparable across load.

`--profile` runs the generated server under the V8 sampling profiler for one route and folds the samples into the steps of ADR 0012 "The check order" with `boundary-steps.ts`, the one map from the runtime's function names to steps. Steps 3 and 8 have no runtime code (the generator refuses them until a contract needs them); the idempotency claim and the glue that runs the steps in order get rows of their own.
