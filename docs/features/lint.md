# Lint

Lint reads your contract and warns about things that compile but look wrong. Run it in the app folder.

```sh
npx seampact lint
```

You see `Linted 1 api(s): 0 error(s), 0 warning(s).` A finding prints the file, the line, the rule and the fix.

```text
api.yaml:26:7: warning seampact/credential-name: The property 'Note.token' is named like a credential and is not sensitive. Fix: Mark 'Note.token' sensitive, or allow seampact/credential-name on it with a reason.
```

Warnings do not fail. An error does: the command exits with 1. `lint` reads sources with a `path`, not bundles.

## The rules

| Rule | Reports |
|---|---|
| `seampact/subtree-exception` | A safety exception written above a route, so it reaches every route below. |
| `seampact/cookie-without-csrf` | A cookie scheme without `csrf`. |
| `seampact/redundant-maturity` | A `maturity` equal to the one the route already has. |
| `seampact/field-right-unresolved` | An output field that is always absent on a route. |
| `seampact/credential-name` | A property named like a credential (`token`, `password`, `apiKey`) and not `sensitive`. |
| `seampact/unused-declaration` | A declaration that no route, identity or convention uses. |

All are warnings by default.

## Change a rule level

Set the level under `lint.rules` in `api.yaml` or in the shared file: `disabled`, `warning` or `error`.

```yaml
lint:
  rules:
    seampact/unused-declaration: error
    seampact/credential-name: disabled
```

With `error`, a finding fails `lint` and `compile`. With `disabled`, the rule does not run. Write `disabled`, not `off`: YAML reads `off` as a boolean.

## Allow one case

To silence a rule in one place, put `lint.allow` on that property, route or declaration, with a reason.

```yaml
token:
  type: string
  lint:
    allow:
      seampact/credential-name: "A public share token, not a secret."
```

On a route, the allow reaches every route below it. Each rule's fix says where its allow goes.

## Your own rules

House rules are planned. `seampact lint` does not load plugins yet, so a level set for a rule no plugin owns prints `seampact/lint/unclaimed-rule` and is ignored.

Errors: [Troubleshooting](../troubleshooting/README.md). The rules in full: [Grammar 12](../grammar/12-enums-examples-docs-extensions.md).
