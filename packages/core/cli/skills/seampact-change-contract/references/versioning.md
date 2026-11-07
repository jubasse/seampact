<!-- Generated from docs/contract/06-versioning.md, docs/contract/07-advanced.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Versioning and change

Page: https://jubasse.github.io/seampact/contract/06-versioning/

Use this page to version an api, say how stable a route is, and retire a route. Three things move over time: the version in the path, how stable a route is, and a route you want to retire.

## The path version

`api.version` is an integer. It fills `{version}` in the surface prefix.

```yaml
# contract/api.yaml, top level
api:
  name: notes
  version: 2
surfaces:
  app:
    prefix: /v{version}
```

Paths now start with `/v2`. Write `{version}` and never a literal `/v2`: the version lives in one place.

An api versioned by a header or a date uses `pathVersion: none` on the surface and a quoted date as the version. See [the api file](https://jubasse.github.io/seampact/grammar/05-the-api-file/).

## How stable is it

`maturity` is `experimental`, `provisional` or `stable`. Set it on the api for all routes, and on a route to override (it flows down, see [Settings flow down the tree](https://jubasse.github.io/seampact/contract/01-basics/#settings-flow-down-the-tree)). It matters because `diff` does not fail on a breaking change to an `experimental` route ([Diff](https://jubasse.github.io/seampact/features/diff/)).

```yaml
# contract/api.yaml, top level
api:
  name: notes
  version: 1
  maturity: provisional
```

```yaml
# under a route, for example surfaces.app.routes.export
export:
  method: post
  maturity: experimental
```

A route that states nothing is `experimental`: the least promise.

## Refuse breaking changes

`compat` makes `seampact diff` fail on a change that breaks existing clients. A change is additive if existing clients still work, and breaking if one can fail.

```yaml
# contract/api.yaml, top level
api:
  name: notes
  version: 1
  compat: { policy: additive-only }
```

Run `diff` against a saved baseline: see [Diff](https://jubasse.github.io/seampact/features/diff/).

## Retire a route

Mark it deprecated. Generated servers send the `Deprecation` and `Sunset` headers and a `Link` to the successor.

```yaml
# contract/api.yaml, under surfaces.app.routes
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
- `successor` names a route of the same api, and goes on a route, not on a node. A successor in another api is refused by `generate`.
- Keep the route working until `sunset` has passed.

## Next

- Next: [Advanced](https://jubasse.github.io/seampact/contract/07-advanced/).
- In depth: [The api file](https://jubasse.github.io/seampact/grammar/05-the-api-file/) and [Lists, cache and lifecycle](https://jubasse.github.io/seampact/grammar/10-lists-cache-and-lifecycle/).

# Advanced

Page: https://jubasse.github.io/seampact/contract/07-advanced/

Use this page for uploads, downloads, lost updates, cache and shared bases. Each section is one feature. Add it only when you need it. Each snippet goes under a route of a surface (`surfaces.app.routes`) unless it says otherwise.

## Upload a file

Declare a `multipart` input. A file field says which media types and which size it accepts.

```yaml
attach:
  method: post
  inputMedia: multipart
  bodyLimit: 25MiB
  input:
    type: object
    required: [file]
    properties:
      file: { file: { media: [image/png, application/pdf], maxSize: 20MiB } }
      caption: { type: string, maxLength: 200 }
  output: Note
```

A file of another type or above `maxSize` is refused with a `400`. A body above `bodyLimit` is refused with a `413`.

## Download a file

An `output` that is a file is a download. The handler returns the bytes or a stream; each [server guide](https://jubasse.github.io/seampact/documentation/#server-guides) shows how.

```yaml
export:
  method: get
  output: { file: { media: [application/pdf, text/csv] } }
```

## Catch lost updates

Ask the client for the version it read. With the version in the body, a stale write answers `409`; with `If-Match`, `412` (below).

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  concurrency: { version: body.expectedVersion, field: version }
  ops:
    update: { input: UpdateNote }
```

`field` is the property of `Note` the version is compared with. seampact adds `expectedVersion` to the input: do not declare it in `UpdateNote`.

Every response that carries a note writes its `ETag` from `field`.

To send the version in the `If-Match` header instead, write `version: header.If-Match`:

```yaml
concurrency: { version: header.If-Match, field: version }
```

- A write without the header, or with an empty one, answers `428`.
- A stale tag answers `412`: the handler returns the `preconditionFailed` error (see "Write a handler" in your [server guide](https://jubasse.github.io/seampact/documentation/#server-guides)).
- The tag can be strong (`"7"`) or weak (`W/"7"`). The handler receives the version unquoted: `7`. Each server guide shows the comparison.

## Cache a read

```yaml
# contract/api.yaml, top level
conventions:
  cache: { families: { minute: 60s } }
```

```yaml
# on a GET route, or on a node above it
cache: { freshness: minute, etag: true }
```

A family is a named freshness, such as `minute: 60s`, that routes reuse. `freshness` names a family from `conventions.cache.families`. `etag: true` adds conditional `GET`. Write `cache` on a `GET` route or on a node above it.

## Several success statuses

`responses` replaces `output` when a route answers more than one way, such as a `202` with a `Location` header.

```yaml
export:
  method: post
  responses:
    202:
      headers: { Location: { type: string, format: uri-reference } }
```

## Share a base between apis

Put what several apis share (schemes, identities, errors, conventions) in a base file. `extends` copies its parts into this api. A name defined in both files is an error.

```yaml
# top of contract/api.yaml
extends: ./base.yaml
```

A pack is a set of conventions you reuse, such as a paging style. Add it with `packs:`. See [Convention packs](https://jubasse.github.io/seampact/features/convention-packs/).

## Next

- Next: [Check it in CI](https://jubasse.github.io/seampact/features/check-in-ci/), or go back to the [contract pages](https://jubasse.github.io/seampact/contract/).
- In depth: [Routes](https://jubasse.github.io/seampact/grammar/07-routes/), [Inherited settings](https://jubasse.github.io/seampact/grammar/08-inherited-settings/), [Lists, cache and lifecycle](https://jubasse.github.io/seampact/grammar/10-lists-cache-and-lifecycle/) and the [worked example](https://jubasse.github.io/seampact/grammar/example/).
