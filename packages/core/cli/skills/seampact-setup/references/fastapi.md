<!-- Generated from docs/backend/fastapi.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# FastAPI

Page: https://jubasse.github.io/seampact/backend/fastapi/

## Set up

You need:

- Python 3.12 or later;
- FastAPI 0.162 (a later minor is untested, see [Versions](https://jubasse.github.io/seampact/backend/fastapi/#versions));
- Pydantic 2.9 or later. Pydantic 1 is refused.

Install seampact from PyPI. Put the generator in your dev dependencies and the runtime in production:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-fastapi[generate]"
```

`uv pip install` and `uv add --dev` take the same requirement. In production, install plain `seampact-fastapi`. Add `seampact-signed-webhooks` if a route is signed by a sender.

A `path` source and the OpenAPI documents need the compiler. Add the extra `seampact-ir[compiler]`, which installs the `seampact-compiler` wheel for your platform. A bundle-only app with `openapi: none` does not need it.

In `seampact.config.yaml`, add one entry per api. Replace the `git` url, the tag and `integrity` with your contract's: `integrity` is the hash `seampact bundle` printed when you published it (see [Share contracts](https://jubasse.github.io/seampact/features/sharing-contracts/)). To try a contract in a local folder, use `path: ./contract` instead and install the compiler extra above.

```yaml
outDir: generated
openapi: none
sources:
  notes:
    git: { url: "https://git.example.com/notes-contract.git", tag: v1.0.0, directory: bundle }
    integrity: sha256-...
targets:
  - id: notes
    out: notes
    use: pypi:seampact-fastapi
    api: notes
    options: { rules: seampact-consistent }
```

The request is checked by [Pydantic](https://jubasse.github.io/seampact/types-and-validation/pydantic/) models; see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Then generate:

```sh
seampact generate
```

The code goes into `generated/notes/`. Import it as `generated.notes.fastapi`, `generated.notes.operations` and `generated.notes.schemas`. Commit the generated files ([Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files)). `seampact check` fails CI when they drift from the contract; [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how to run it.

## Wire it in

`bind_notes()` is the one call your app makes. Make it last, after your own middleware and exception handlers.

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from generated.notes.fastapi import NotesHandlerFactories, bind_notes

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["https://app.example.com"])

bind_notes(
    app,
    handlers=NotesHandlerFactories(notes=notes_endpoints),
    authenticate={"user": user_hook},
    deciders={"notes.update": NotesDecider},
    scope_resolvers={"workspace": WorkspaceResolver},
    on_unexpected_error=NotesErrors,
)
```

- It adds the contract's routes, the exception handlers and the boundary. The boundary is the outermost middleware of the app.
- `handlers` has one factory per resource. `authenticate` has one hook factory per identity, `deciders` one per right or rule, `scope_resolvers` one per scope. Keys are the contract's names.
- Add `CORSMiddleware` before `bind_notes()`. A preflight request passes the boundary and reaches it.
- With two apis, call `bind_<api>()` twice.
- To use an `APIRouter`, pass it as the first argument and add `app=app`. Call `bind_notes()` before `app.include_router(router)`. A prefix on that router is refused: use `mount` on the entry.

Each route is named `seampact.<api>.<operationId>`, and its parameters take the input property names. `NotesRouteNames` holds the names and `NotesUrls` builds the paths. `artefacts: { routeHelpers: false }` leaves both out.
