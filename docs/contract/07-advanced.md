# Advanced

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

An `output` that is a file is a download. The handler returns the bytes or a stream; each [server guide](../README.md#server-guides) shows how.

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
- A stale tag answers `412`: the handler returns the `preconditionFailed` error (see "Write a handler" in your [server guide](../README.md#server-guides)).
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

A pack is a set of conventions you reuse, such as a paging style. Add it with `packs:`. See [Convention packs](../features/convention-packs.md).

## Next

- Next: [Check it in CI](../features/check-in-ci.md), or go back to the [contract pages](README.md).
- In depth: [Routes](../grammar/07-routes.md), [Inherited settings](../grammar/08-inherited-settings.md), [Lists, cache and lifecycle](../grammar/10-lists-cache-and-lifecycle.md) and the [worked example](../grammar/example.md).
