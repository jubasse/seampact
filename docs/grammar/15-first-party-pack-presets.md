### 15. The presets of the first-party packs

The template language must express every format [A28](../decisions.md#a28) and [A32](../decisions.md#a32) name. These are the presets of the first-party packs (ADR 0008), written in the grammar above; the packs hold the full versions.

```yaml
# @seampact/pack-api-platform: JSON-LD items and Hydra collections (excerpt)
formats:
  jsonld:
    media: application/ld+json
    success:
      item:
        body: { '@context': '/contexts/${resource}', '@id': $self, '@type': $resource, $merge: $payload }
    error:
      body:
        '@context': /contexts/Error
        '@id': '/errors/${status}'
        '@type': Error
        type: '/errors/${status}'
        title: $title
        detail: $detail
        status: $status
        code: $code
        $merge: $params
pagings:
  hydra:
    request:
      page: { query: page }
      limit: { query: itemsPerPage }
      sort: { query: 'order[{key}]', style: keyed }
    response:
      body:
        '@context': '/contexts/${resource}'
        '@id': $path
        '@type': Collection
        totalItems: $total
        member: { $each: $items, $as: { '@id': $itemSelf, '@type': $resource, $merge: $item } }
        view: { '@id': $self, '@type': PartialCollectionView, first: $first, last: $last, previous: $previous, next: $next }
```

```yaml
# @seampact/pack-jsonapi (excerpt)
formats:
  jsonapi:
    media: application/vnd.api+json
    success:
      item: { body: { data: { type: $collection, id: '${id}', attributes: $fields, links: { self: $self } } } }
    error:
      body:
        errors:
          - { status: '${status}', code: $code, title: $title, detail: $detail, meta: $params }
pagings:
  jsonapiPages:
    request:
      page: { query: 'page[number]' }
      limit: { query: 'page[size]' }
      sort: { query: sort, style: signed }
    response:
      body:
        data: { $each: $items, $as: { type: $collection, id: '${itemId}', attributes: $itemFields, links: { self: $itemSelf } } }
        links: { self: $self, first: $first, prev: $previous, next: $next, last: $last }
        meta: { total: $total }
```

```yaml
# @seampact/pack-hal (excerpt)
formats:
  hal:
    media: application/hal+json
    success:
      item: { body: { $merge: $payload, _links: { self: { href: $self } } } }
pagings:
  halPages:
    request:
      page: { query: page, base: 0 }
      limit: { query: size }
      sort: { query: sort, style: pair }
    response:
      body:
        _embedded: { $collection: { $each: $items, $as: { $merge: $item, _links: { self: { href: $itemSelf } } } } }
        _links: { self: { href: $self }, first: { href: $first }, prev: { href: $previous }, next: { href: $next }, last: { href: $last } }
        page: { size: $limit, totalElements: $total, totalPages: $totalPages, number: $page }
```

```yaml
# @seampact/pack-laravel: API Resources and paginators; errors stay the bare problem+json (excerpt)
formats:
  laravel:
    success:
      item: { body: { data: $payload } }
      table: { body: { data: $payload } }
      list: { body: { data: $payload } }
      page: { body: { data: $items, meta: $meta } }
pagings:
  laravelPages:
    absent: null
    request:
      page: { query: page }
      limit: { query: per_page }
    response:
      body:
        data: $items
        links: { first: $first, last: $last, prev: $previous, next: $next }
        meta: { current_page: $page, from: $from, last_page: $totalPages, path: $path, per_page: $limit, to: $to, total: $total }
  laravelCursor:
    absent: null
    request:
      cursor: { query: cursor }
      limit: { query: per_page }
    response:
      body:
        data: $items
        links: { first: null, last: null, prev: $previous, next: $next }
        meta: { path: $path, per_page: $limit, next_cursor: $nextCursor, prev_cursor: $previousCursor }
```

```yaml
# @seampact/pack-spring: Page; errors stay the bare problem+json, which the spring-boot target writes with ProblemDetail (excerpt)
pagings:
  springPage:
    request:
      page: { query: page, base: 0 }
      limit: { query: size }
      sort: { query: sort, style: pair }
    response:
      body:
        content: $items
        page: { size: $limit, number: $page, totalElements: $total, totalPages: $totalPages }
```

```yaml
# the core default (ADR 0006 section 7)
formats:
  bare:
    media: application/json
    error:
      media: application/problem+json
      body: { type: $code, title: $title, status: $status, detail: $detail, instance: $instance, code: $code, nature: $nature, traceId: $traceId, $merge: $params }
```

A client discriminates the error union on the member the format writes `$code` to, or, when the code sits inside a text template, matches the received text against the template to recover the code. Strict RFC 9457, with an absolute `type` and no seampact member, is one format away:

```yaml
# packs/house.yaml (excerpt): strict RFC 9457
formats:
  problem:
    error:
      media: application/problem+json
      body: { type: 'https://errors.acme.com/${code}', title: $title, status: $status, detail: $detail, instance: $instance, $merge: $params }
```

The laravel pack covers success bodies and paginators only. Laravel's validation error (`{ message, errors: { <field>: [...] } }`) groups the issues by field, which the template language does not express, so a laravel api answers problem+json errors until a consumer needs that body (lesson 5). Laravel's paginator also writes `meta.links`, a numbered list of page links. It is not a role until a consumer needs it (lesson 5): the laravel target writes the declared shape through `ResourceCollection::paginationInformation`, Laravel's own customisation point (A30).
