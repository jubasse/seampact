# Glossary

One meaning for each word. Other pages link here the first time they use one.

| Word | Meaning |
|---|---|
| contract | The YAML files that describe your API. It starts at `api.yaml`. |
| api | One API in a contract: its `name`, its `version`, its schemas and its routes. `apis: [notes]` in a target entry names it. Not the backend server. |
| source | Where the config finds a contract: `sources.notes` with a `path`, a package or a git tag. The source name is not the api name. |
| surface | An entry point of an api with a path prefix, such as the surface named `app` under `/v1`. Its routes and its `access` rule live under it. See [the shape of a contract](../contract/01-basics.md). |
| collection | A route of `kind: collection`: a list of records with an id, and the standard operations on them (`list`, `get`, `create`, `update`, `delete`). |
| target | One kind of output, such as the types, the NestJS server or the fetch client. You add it as an entry in `targets:`. |
| entry | One item of the `targets:` list in `seampact.config.yaml`, with an `id`, a `use`, `apis` and optional `link` and `options`. |
| generator | The package an entry names in `use`, such as `@seampact/codegen-nestjs`. It writes the code. See [the package map](packages.md). |
| link | A `link` in an entry names the other entries it builds on, for example `types: types`. See [targets and links](../configuration/targets-and-links.md). |
| handler | The code you write for one operation. seampact generates the interface and calls your handler. It is a controller method on NestJS, Spring Boot, Laravel and Symfony, a function or method on Express, Fastify, Hono, AdonisJS and FastAPI, and a view method on Django. |
| hook | Code you give the generated server: authenticate, decide or resolve a scope. It is an object on Node, an interface implementation on Spring Boot, a class on Laravel and Symfony, and a function or class on Python. The app refuses to start while one is missing. |
| boundary | The generated code that checks each request and each reply against the contract. |
| bundle | A packed, versioned copy of a contract that other repositories pin and reuse. `seampact bundle` makes it. See [sharing contracts](../features/sharing-contracts.md). |
| app | One project with its own `seampact.config.yaml`: a backend, a frontend or a service. |
| workspace root | The folder of a contract's entry file: `workspace.yaml`, or the api file when a contract has one api and no `workspace.yaml`. Contract paths stay inside it. |
| monorepo root | In a monorepo, the folder whose `seampact.config.yaml` lists the apps with `apps:`. See [monorepo](../configuration/monorepo.md). |
| IR | The compiled form of a contract, which every generator reads. You never write it. |
| refusal code | The code a target prints when it cannot generate a form yet, such as `input.form.unsupported`. `generate` stops. See [troubleshooting](../troubleshooting/README.md). |
| rule id | The name of a lint rule, such as `seampact/credential-name`. `lint` prints it with the finding. See [lint](../features/lint.md). |

Next: [Install](../getting-started/01-install.md).
