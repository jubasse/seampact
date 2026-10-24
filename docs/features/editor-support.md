# Editor support

Your editor can check contract keys and the names you declare, and complete them as you type.

`seampact init` sets this up in a new project. In an existing one, `npx seampact init --modelines` writes the first line below in every contract file, and the schemas.

Run once after a checkout, and again after you declare a new name:

```sh
npx seampact compile --editor-schemas
```

It writes schemas to `.seampact/schemas` in the workspace root (set `workspace.editorSchemas` to change it). Add that folder to `.gitignore`.

Point each file at its schema on its first line, with a path relative to the file:

```yaml
# yaml-language-server: $schema=.seampact/schemas/api.schema.json
```

VS Code needs the YAML extension (Red Hat).

Errors: [CLI errors](../troubleshooting/cli.md).
