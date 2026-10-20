# Advanced

Each section is one feature. Add it only when you need it.

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

An `output` that is a file is a download. The handler returns the bytes or a stream.

```yaml
export:
  method: get
  output: { file: { media: [application/pdf, text/csv] } }
```

## Catch lost updates

Ask the client for the version it read. A stale write answers `409`.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  concurrency: { version: body.expectedVersion, field: version }
  ops:
    update: { input: UpdateNote }
```

`field` is the property of `Note` the version is compared with. Seampact adds `expectedVersion` to the input: do not declare it in `UpdateNote`.

## Cache a read

```yaml
cache: { freshness: minute, etag: true }
```

`freshness` names a family from `conventions.cache.families`. `etag: true` adds conditional `GET`. Write `cache` on a `GET` route or on a node above it.

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

Put what several apis share (schemes, identities, errors, conventions) in a base file and extend it.

```yaml
extends: ./base.yaml
```

A pack is a set of conventions you reuse, such as a JSON:API format. Add it with `packs:`. See [Convention packs](../grammar/15-first-party-pack-presets.md).

## What is next

- Everything above, in full: [Routes](../grammar/07-routes.md), [Inherited settings](../grammar/08-inherited-settings.md) and [Lists, cache and lifecycle](../grammar/10-lists-cache-and-lifecycle.md).
- A full contract with every feature: [Worked example](../grammar/example.md).
