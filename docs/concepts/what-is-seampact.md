# What is seampact

seampact turns one YAML contract into the server code, the typed clients and the OpenAPI document of your HTTP API. You describe each route once: its path, its input, its replies, its errors and who may call it. seampact writes the code around your handlers, and your handlers stay yours.

The generated server code checks every request and every reply against the contract. The generated clients call the same routes with the same types. In CI, `seampact check` fails when the generated files no longer match the contract, so the server, the clients and the documents never drift.

The flow is short:

1. Write the contract in YAML.
2. Run `npx seampact generate`.
3. Write your handlers, and call the API from your client.
4. Run `npx seampact check` in CI.

seampact works with Node.js, Spring Boot, Laravel, Symfony and Python servers, and with React, Vue, Angular and mobile clients. [Supported stacks](../../README.md#supported-stacks) lists every framework and version.

Next: [what you get and what you write](what-you-get.md), or start with [Install](../getting-started/01-install.md).
