### The consumer and the proof

The sample apps live in `scripts/consumers/targets/drf/` and `scripts/consumers/targets/ninja/`, shaped as ADR 0026's: the handlers, the hook doubles, the three control routes, and the state in one file, since gunicorn and uvicorn run several workers. Each installs the seampact wheels `uv build` writes and the reference contract's bundle.

`p7-drf.yml` has, beside `changes` and the `packages` tests:

- `e2e`, two rows on `ubuntu-24.04` with `actions/setup-python`: {Python 3.12, Django 5.2, DRF 3.18 floor, gunicorn WSGI} and {the latest Python, the latest Django 6.x, the latest DRF, uvicorn ASGI}. Node is removed, the app is installed with pip only and generated, then Node comes back for the suite alone, as ADR 0026 says. It runs the `default`, `hand-written` and `boot` profiles (ADR 0015 "Suite profiles") over every operation of both apis, from drf-3; a boot imports the WSGI or ASGI module of a misconfigured variant, whose handler runs the boot check;
- `drf`, the aggregate.

`p7-ninja.yml` has the same jobs, with rows {Python 3.12, Django 5.2, the Ninja floor, gunicorn, `views: sync`} and {the latest Python, the latest Django 6.x, the latest Ninja, uvicorn, `views: async`}, every profile, and the aggregate `ninja`.

The proof is the `node`-absent step, a green suite row per row above, each target's `test_redaction.py`, and the suite's security rows. The suite runs every case of the reference contract.
