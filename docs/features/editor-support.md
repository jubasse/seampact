# Editor support

Use editor schemas to get completion and checks on contract keys and on the names you declare, as you type in VS Code.

Each contract file starts with a modeline that points to its schema, with a path relative to the file. For `contract/api.yaml`:

```yaml
# yaml-language-server: $schema=./.seampact/schemas/api.schema.json
```

`seampact init` writes this line and the schemas in a new project. In an existing one, `npx seampact init --modelines` writes the line in every contract file.

The schemas live in `.seampact/schemas` inside the contract folder (the folder of `workspace.yaml` or `api.yaml`). Set `workspace.editorSchemas` to change it. Add that folder to `.gitignore`.

Run this once after a checkout, and again after you declare a new name:

```sh
npx seampact compile --editor-schemas
```

VS Code needs the YAML extension (Red Hat). Other editors are not covered here.

Errors: [CLI errors](../troubleshooting/cli.md).

## Next

Next: [Lint](lint.md).
