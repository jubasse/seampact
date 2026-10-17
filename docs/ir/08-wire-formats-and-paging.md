### 8. Wire formats and paging styles

A wire format ([A30](../decisions.md#a30), ADR 0008) is data in `formats`, and a paging style ([A31](../decisions.md#a31)) is data in `pagings`, both with the template language of ADR 0002 sections 13 and 14. The core default `bare` appears in `formats` too, like a pack format, so targets handle one model:

```ts
interface WireFormat {
  id: FormatId; origin;
  media: string;                             // 'application/json', 'application/ld+json'
  absent: 'omit' | 'null';
  success: { item: Shape; table: Shape; list: Shape; page: Shape };   // defaults filled: body '$payload' ('$items' for page), no headers
  meta: Record<string, { type: TypeUse; fill: 'now' | 'traceId' | 'degraded' | 'handler' | ValueSource }>;
  error: { media: string; body: Template; headers: HeaderTemplate[] };   // 'application/problem+json' for 'bare'
}
interface Shape { body: Template; headers: HeaderTemplate[] }
interface HeaderTemplate { name: string; value: Template }

interface PagingStyle {
  id: PagingId; origin;
  position: 'cursor' | 'page' | 'offset' | 'since';
  absent: 'omit' | 'null';
  request: { role: 'cursor' | 'after' | 'before' | 'page' | 'offset' | 'since' | 'limit' | 'sort';
             in: 'query' | 'header'; name: string; base?: 0 | 1; style?: 'signed' | 'pair' | 'keyed' | 'split';
             direction?: string }[];                // split: the direction parameter's name
  response: { body?: Template;               // the whole page body; absent when the style adds 'meta' to the format's page
              meta: { name: string; value: Template }[];   // members joining the format's page $meta
              headers: HeaderTemplate[]; links: { rel: string; role: UrlRole }[] };
  handlerResult: ('nextCursor' | 'previousCursor' | 'total' | 'more' | 'nextSince' | 'complete')[];
}
type UrlRole = 'self' | 'first' | 'previous' | 'next' | 'last';

type Template =
  | { kind: 'slot'; slot: Slot; path: string[] }   // '$payload', '$item.taskId' (path ['taskId'])
  | { kind: 'text'; parts: ({ text: string } | { slot: Slot; path: string[] })[] }   // '/contexts/${resource}'
  | { kind: 'literal'; value: unknown }
  | { kind: 'object'; members: { name: string | { slot: Slot }; value: Template }[]; merge?: Slot }
  | { kind: 'array'; items: Template[] }
  | { kind: 'each'; of: Slot; as: Template };
```

An `object` template either wraps (the payload under a member, `{ data: $payload, meta: $meta }`) or merges (`merge: 'payload'`, the payload's own members beside the format's members, as JSON-LD puts `@context`, `@id` and `@type` beside an item's fields). An `each` template maps every element of an array slot, as Hydra's `member`, JSON:API's resource objects and HAL's `_embedded` need. Each response records its media type and its `shape`, so a target finds the template without guessing: `item`, `table` and `list` read the format; `page` reads the operation's paging style's `body` when it has one, and otherwise the format's `page` shape with the style's `meta` members in its `$meta`. The IR stores the unwrapped payload and the format and style references only; nothing restates the envelope (FR-42). `handlerResult` lists what the handler returns beside the items, so a target types the handler's page result without reading templates. The slot catalogue, the roles and who fills each one are ADR 0002 sections 13 and 14; the members of the `bare` error body (RFC 9457) are ADR 0006 section 7.
