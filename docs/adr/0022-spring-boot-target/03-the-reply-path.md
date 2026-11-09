### The reply path

The reply handler writes every contract reply:

- with `setStatus`, `setHeader` and the output stream, its body serialized by the boundary's own Jackson 3 `JsonMapper`, never the app's `HttpMessageConverter`s or mapper bean;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

An item, table or list body goes out in its format's success envelope (ADR 0002 section 13), `{ data: $payload }` under `pack:laravel`, the payload itself under a bare format, as the Node and PHP targets write it; the ETag is the enveloped body's. A `null` body is the format's null (`null` bare, the envelope with a null payload), which the body check refuses unless the schema makes it nullable; a `null` list, table or page is a violation. Generation refuses an envelope that does not write `$payload` under named members (`format.success.envelope.unsupported`), a slot beside the payload, the status and the path (`format.success.slot.unsupported`), a success format header (`format.success.headers.unsupported`) and the format's meta members (`format.meta.unsupported`).

Content negotiation is not consulted. A client's `Accept` changes nothing that the contract does not say.

The value goes through the same handler after an asynchronous dispatch, since Spring hands the dispatch's concurrent result to the same list (spike).
