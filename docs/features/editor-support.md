# Editor support

Use editor schemas to get completion and checks on contract keys and on the names you declare, as you type in VS Code, or any editor with a YAML language server.

Each contract file starts with a modeline that points to its schema, with a path relative to the file. For `contract/api.yaml`:

```yaml
# yaml-language-server: $schema=.seampact/schemas/api.schema.json
```

`seampact init` writes this line and the schemas in a new project. In an existing one, `seampact init --modelines` writes the line in every contract file. `init` is a Node command. `compile --editor-schemas` also runs with the compiler binary: see [commands per stack](commands-per-stack.md).

The schemas live in `.seampact/schemas` inside the contract folder (the folder of `workspace.yaml` or `api.yaml`). Set `workspace.editorSchemas` to change it. Add that folder to `.gitignore`.

Run this once after a checkout, and again after you declare a new name:

```sh
seampact compile --editor-schemas
```

VS Code needs the YAML extension (Red Hat). Another editor reads the same modeline through any YAML language server.

Errors: [CLI errors](../troubleshooting/cli.md).

## Next

[Lint](lint.md).
