### Python core

#### Distributions

Every package is a PEP 420 `seampact.*` namespace distribution in the uv workspace `python/`, with `python/uv.lock` committed and used with `--locked`. No distribution ships `seampact/__init__.py`.

| Distribution | Module | Holds | Depends on |
|---|---|---|---|
| `seampact-ir` | `seampact.ir` | the IR model, naming, the reader, the bundle, the binary, the app config, the entry view, the channels, the writer, the `seampact` console script, the `Generator` protocol, the matrix copy | `ruamel.yaml`, `jsonschema`; extra `compiler` |
| `seampact-hooks` | `seampact.hooks` | hook protocols, decision and subject types, `Field`, store and redaction protocols | nothing |
| `seampact-signed-webhooks` | `seampact.signed_webhooks` | ADR 0013's five steps | nothing |
| `seampact-codegen` | `seampact.codegen`, `.runtime`, `.runtime.pydantic` | the neutral emitters and the framework-free runtime | `seampact-hooks`; extras `pydantic` and `generate` (`seampact-ir`) |
| `seampact-fastapi` | `seampact.fastapi`, `.runtime` | the FastAPI generator and placement | `fastapi`, `seampact-codegen[pydantic]==<self>`; extra `generate` |
| `seampact-django`, `seampact-drf`, `seampact-ninja` | | ADR 0027 | |

`==<self>` is the exact version the release pipeline stamps (ADR 0025 "Version guards", G1). The generator and the runtime of a framework ship in one distribution (ADR 0025 option D), so G2 holds by construction, as in PHP. The generator's own dependencies sit behind the `generate` extra: an app runs `pip install seampact-fastapi` for production and `pip install "seampact-fastapi[generate]"` as a dev dependency. uv, Poetry and pip-tools read the same metadata.

The core holds everything framework-free: getting the IR, the runner, the hooks, the neutral codegen plan, and the runtime of step 1's decoding, steps 2 to 5, field rights, idempotency, cache headers, paging, replies and the outgoing verdict. A framework distribution holds only its placement: where the steps run, how it reads the request and writes the reply, its exception map and its boot check.

The runner finds targets through the entry point group `seampact.generators`, read with `importlib.metadata`. Each target implements the `Generator` protocol.

#### The binary and the root project

ADR 0010 "The Python channels" holds. The `seampact-compiler` wheel puts the binary at `seampact/compiler/bin/<asset>`. Only the `pyproject.toml` of the project directory sets an override. A `[tool.seampact.binary]` table in a uv workspace member, or in a locally installed project (read from its `direct_url.json`), is refused (`binary.override-not-root`, naming the file). A project without a `pyproject.toml` has no override: a pip-only project is legitimate, unlike a Composer project without `composer.json`.

#### Versions

- **Python.** 3.12 is the floor of every distribution; CI runs 3.12 and the latest Python. 3.10 reached its end of life in October 2026, and Django 6 needs 3.12.
- **FastAPI.** 0.162, the latest minor today, is the matrix `floor`. FastAPI breaks in minors, so the matrix records it per minor, and CI runs the floor and the latest. An older minor is refused (`config.matrix.incompatible`); a newer one is untested (ADR 0009). `allowUntested` names a 0.x framework by its minor (`fastapi@0.163`), since 0.x minors break.
- **Starlette.** Through FastAPI's own range: FastAPI 0.162 asks for `starlette>=0.46.0`. The spike ran 0.46.0 and 1.10.0.
- **Pydantic.** 2.9 or later, FastAPI 0.162's own floor. Pydantic 1 is refused (`config.matrix.incompatible`). The generated models never use the `pydantic.v1` shim.
- **Distributions and locks.** A distribution declares a range from its floor for the framework it serves, and the exact `==<self>` for the seampact distributions it needs (G1). The workspace lock and the CI rows pin every package exactly, with hashes.

#### Sync and async

The shared runtime writes each step once, as a coroutine. FastAPI awaits them. A sync placement (ADR 0027) drives them with a driver that refuses a suspension as the boundary's 500.

A hook or handler method may be a plain `def` or an `async def`. The runtime awaits an `async def` method on the event loop. It runs a `def` method with Starlette's `run_in_threadpool`, which carries the caller's context variables (spike), and awaits an awaitable that a `def` returns. The threadpool is anyio's default limiter (40 threads), shared with FastAPI's own `def` dependencies; the FastAPI guide says so.

The runtime keeps per-request state in the ASGI scope, in one mutable holder under a seampact key that step 1 puts there, never in module globals: a long-lived worker serves many requests at once, and an inner middleware that copies the scope keeps the same holder.

#### Hook protocols

`seampact-hooks` reads the shared hooks shape manifest (`fixtures/hooks-shape/shape.json`), as the npm, Java and PHP hooks packages do:

- `AuthenticateHook`, `DecideHook`, `ResolveScopeHook` and `IdempotencyStore` are `typing.Protocol` classes. Each method returns `T | Awaitable[T]`, so a `def` and an `async def` both satisfy it.
- Values are frozen slotted dataclasses. A union's arms live in the union's module (`seampact.hooks.decision.Allowed`).
- Manifest members in camel case read as snake case. An optional member defaults to `None`; a nullable one is `T | None` without a default.
- `Field[T]` is `T | Literal[Absent.ABSENT]`, with `Absent` a one-member enum, so an absent member and an explicit `None` stay apart (CHK-158).
- `seampact-hooks` has no dependency, so an app can vendor it.

The per-api `UnexpectedErrorListener` protocol (`TasksUnexpectedErrorListener`) is generated in the api's `fastapi` module and extends the runtime's; `bind_<api>()` takes its factory, so each api's listener hears only that api's failures.

Each identity an operation reads gets a frozen credentials class in the `operations` module (`UserCredentials`), one `str | None` attribute per scheme, hidden from `repr`. The authenticate hook receives an instance in `credentials`, as the Node and PHP targets give theirs.

#### Naming

Python names follow ADR 0007 sections 4 and 5: types in Pascal case, attributes, functions and members in snake case, enum members in upper snake case, a reserved word escaped with a trailing `_`, and a member whose name starts with a digit prefixed with `field_`. The generated models set Pydantic's `protected_namespaces=()`. Generated code imports framework names qualified or under private aliases, never a bare `BaseModel` or `Field` beside contract names.

#### From the PHP core

| PHP choice | Here | How |
|---|---|---|
| package split `ir`, `hooks`, `codegen`, one per framework | adapted | PEP 420 namespace distributions, plus `seampact-django` for the Django layer (ADR 0027) |
| generator and runtime in one framework package | kept | the generator's dependencies move to a `generate` extra |
| read-only mirror repositories and the split job | dropped | PyPI publishes from the monorepo; tests install from wheels `uv build` writes |
| binary fetched by a download | adapted | `seampact-compiler` platform wheels; pin, hash, cache and platform refusals stay |
| `extra.seampact.generator` discovery | adapted | entry point group `seampact.generators` |
| `extra.seampact.binary` in the root `composer.json` | adapted | `[tool.seampact.binary]` in the root `pyproject.toml` |
| PSR-4 check on `outDir` | dropped | the generated modules import each other by package-relative imports, so `outDir` need not be an importable path of the project; the default stays `__generated__` ([A41](../../decisions.md#a41)) |
| `nette/php-generator` printer | dropped | an own deterministic line printer, its golden checked by `ruff format --check`, never `ast.unparse` |
| hooks shape manifest and `Field` | kept | `typing.Protocol`, frozen slotted dataclasses, `Field` with the `Absent` sentinel |
| hooks as container bindings or tagged services | dropped | FastAPI: factories that are FastAPI dependencies; Django: dotted paths in `settings.SEAMPACT` |
| boot check in `booted()` or a compiler pass | dropped | FastAPI: `lifespan.startup` in the boundary; Django: a system check and the middleware's `__init__` |
| first-request "boundary first" assertion | kept | for a server or test client that runs no lifespan |
| boundary first, raw-path match, route-chosen comparison | kept | Starlette and Django decode the path before routing, as Laravel and Symfony do |
| FormRequest rules and Validator constraints | dropped | Pydantic in strict mode (FastAPI, Ninja), DRF serializers (DRF); the split between a generated type layer and native value rules stays |
| `rules: native` or `seampact-consistent` | kept | `native` is the default |
| exception map by class, then by status | kept | Starlette `HTTPException` here; Django and DRF exceptions in ADR 0027 |
| per-api identity classes (ADR 0025) | kept | a per-api contract exception base |
| settings through `env()` | adapted | FastAPI: keyword arguments of `bind_<api>()`, values from the app's own settings; Django: `settings.SEAMPACT["<api>"]` |
| Octane and worker-mode refusals | dropped | long-lived ASGI workers are the norm; state lives in the request scope |
| redaction by `__debugInfo()` and a VarDumper caster | adapted | `__repr__` and `__rich_repr__` print `[redacted]` |
| `php -S` for the consumers | dropped | uvicorn, and gunicorn for Django |
| PHPStan max on the golden | adapted | `mypy --strict` and `pyright` strict |
