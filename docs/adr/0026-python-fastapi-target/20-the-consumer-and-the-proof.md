### The consumer and the proof

The sample app lives in `scripts/consumers/targets/fastapi/`. It holds the developer's handlers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a `logging.Handler`. uvicorn may run several workers, so the script, the hook calls and the log lines live in one file. It installs `seampact-hooks`, `seampact-codegen`, `seampact-ir`, `seampact-fastapi` and `seampact-signed-webhooks` (its stripe hook verifies signatures) from wheels that `uv build` writes (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle.

The workflow `p7-fastapi.yml` has, beside `changes` and the `packages` tests:

- `contract-bundle` (Node), which bundles the reference contract with the compiler binary; the consumer fetches it from a local git repository with its integrity pin;
- `e2e`, two rows on `ubuntu-24.04` with `actions/setup-python`: {Python 3.12, FastAPI 0.162 with its floor Starlette and Pydantic} and {the latest Python, the latest FastAPI, Starlette and Pydantic}, both on uvicorn. Node is removed first, and the step fails if `node`, `npm` or `npx` is still found. It installs the app with pip only and generates. Node then comes back for the suite alone, which runs the `default`, `hand-written` and `boot` profiles (ADR 0015 "Suite profiles"), over every operation of the tasks and tasksService apis; a boot is a uvicorn start of a misconfigured variant;
- `fastapi`, the aggregate, failing on any failed or cancelled job, or one skipped although `changes` said run.

The proof is:

- the `node`-absent step;
- a green suite row per Python version;
- `python/fastapi`'s `test_redaction.py` (one generated class of each kind of "Redaction", holding a known secret, which `repr`, `str`, `pprint`, `logging` with `%r` and `rich` must not show while `[redacted]` is present), and the suite's security rows.

The suite runs every case of the reference contract: the consumer's refusal list is empty.
