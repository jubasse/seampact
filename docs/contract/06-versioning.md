# Versioning and change

Three things move over time: the version in the path, how stable a route is, and a route you want to retire.

## The path version

`api.version` is an integer. It fills `{version}` in the surface prefix.

```yaml
api:
  name: notes
  version: 2
surfaces:
  app:
    prefix: /v{version}
```

Paths now start with `/v2`. Write `{version}` and never a literal `/v2`: the version lives in one place.

An api versioned by a header or a date uses `pathVersion: none` on the surface and a quoted date as the version. See [the api file](../grammar/05-the-api-file.md).

## How stable is it

`maturity` is `experimental`, `provisional` or `stable`. Set it on the api for all routes, and on a route to override.

```yaml
api:
  name: notes
  version: 1
  maturity: provisional
```

```yaml
export:
  method: post
  maturity: experimental
```

A route that states nothing is `experimental`: the least promise.

## Refuse breaking changes

`compat` makes `seampact diff` fail on a change that breaks existing clients.

```yaml
api:
  name: notes
  version: 1
  compat: { policy: additive-only }
```

Run `diff` against a saved baseline: see [Diff](../features/diff.md).

## Retire a route

Mark it deprecated. Generated servers send the `Deprecation` and `Sunset` headers and a `Link` to the successor.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops: [get]
  member:
    routes:
      fetch:
        method: get
        output: Note
        deprecated: { since: '2026-12-31', sunset: '2027-06-30', successor: getNote }
```

- Dates are quoted. An unquoted date is refused.
- `successor` names a route, so it goes on a route and not on a node.
- Keep the route working until `sunset` has passed.

## What is next

- Settings that carry the lifecycle: [Lists, cache and lifecycle](../grammar/10-lists-cache-and-lifecycle.md).
- The api file: [The api file](../grammar/05-the-api-file.md).
