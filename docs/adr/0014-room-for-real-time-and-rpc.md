# ADR 0014: Room for real-time and RPC

Status: accepted

## Context

Real-time (WebSocket, Server-Sent Events, AsyncAPI), gRPC and GraphQL are out of the first versions (FEAT-001 non-goals). This ADR keeps room for them in the IR, so they can arrive later without a breaking change. After 1.0, a removal or change of meaning in the IR bumps `irVersion` and the major version (amendment [A8](../decisions.md#a8)), so whatever room is needed must exist when the IR is frozen for targets (FR-37).

[Lesson 5](../decisions.md#lesson-5) forbids building ahead of use: no keyword, IR field or target code for these transports now. The question is only which IR properties would otherwise force a breaking change later.

The IR shape and its evolution rules belong to ADR 0004 and ADR 0005. This ADR states the constraints they must meet; the field names are theirs.

## Decisions

### What is reserved: constraints on the IR, not features

Options: model channels and RPC methods now with no target; reserve nothing and accept an `irVersion` bump later; reserve the few structural properties a later transport needs.

Choice: the third. Each constraint below is cheap now and expensive after 1.0.

1. **Declarations are transport-neutral.** Schemas, enums, errors, identities, rights, rules and scopes are declared at the api level and referenced by id, never nested inside an HTTP operation. A later channel message or RPC method references the same declarations.
2. **HTTP operations are one kind among several.** The IR keeps HTTP operations in their own collection. A later transport adds a sibling collection (for example channels with their messages, or RPC services with their methods). It never adds new values to the HTTP method enum or reuses HTTP fields with another meaning.
3. **The IR lists the kinds it uses.** The top level of the IR names the declaration kinds present (HTTP operations today). A target declares the kinds it supports; a target that meets an IR using a kind it does not support fails `generate` with a diagnostic naming the kind (FR-14). Without this list, a target that ignores unknown fields (FR-37) would silently skip a declared channel, which breaks "declared means derived" ([lesson 2](../decisions.md#lesson-2)).
4. **Media types are explicit.** Every request and response body records its media type. A Server-Sent Events stream (`text/event-stream`) or a later streaming body is then a new media kind, not a change to what "a response" means. This is also what the wire formats of ADR 0008 need.
5. **An error is identified by its code, not by its HTTP status.** The status is an attribute of the error for the HTTP transport. A gRPC status or a GraphQL error extension can be added later as another per-transport attribute.
6. **Hook requests reference the declaration by kind and id.** The operation reference in the hook requests of ADR 0012 carries the declaration kind, so the same authenticate, decide and resolve-scope hooks can later serve a WebSocket handshake or a gRPC call.
7. **Schema direction is a property of each use.** A message a client sends is input, a message the server sends is output (ADR 0003). Channels reuse direction without a new concept.
8. **Properties have an extension slot.** A later protobuf target needs stable field numbers that cannot be derived from names. They would live in an extension slot on properties (FR-37) until a transport kind makes them core.

### What each future transport would need, for the record

| Transport | Fits the reserved room by | Open question left for its own ADR |
|---|---|---|
| Server-Sent Events | an HTTP GET whose response media kind is an event stream of declared messages | reconnection and last-event-id semantics |
| WebSocket | a channel kind; authentication at the HTTP upgrade with the same identities | message correlation and per-message rights |
| AsyncAPI | an emitter beside the OpenAPI emitter, reading channels from the IR | none structural |
| gRPC | an RPC kind; errors gain a gRPC status attribute; field numbers from an extension slot | streaming methods, mapping tagged unions to `oneof` |
| GraphQL | the weakest fit: a graph schema is not a set of operations | whether to support it at all |

None of these is planned for 1.0, and none has a named consumer (lesson 5).

### What is not reserved

- No authoring keyword (ADR 0002) and no IR field beyond the eight constraints above.
- No placeholder target package, emitter or runtime helper.
- No promise that GraphQL will ever be supported.

## Consequences

- ADR 0004 must include the kinds list, explicit media types, code-identified errors with the HTTP status as an attribute, and kind-tagged operation references in hook requests. ADR 0005 must treat a new declaration kind as an additive change that every older target refuses by name rather than ignores.
- A later real-time or RPC transport is an additive IR change: `irVersion` stays the same after 1.0, and older targets fail clearly on contracts that use it.
- The cost now is one top-level list and a few attributes that HTTP-only consumers barely notice.

## Traceability

- FRs: FR-37 (additive by design), FR-14 (a target refuses a feature it cannot express), FR-9 (versioned IR); amendment A8; FEAT-001 non-goals.
- Checklist items enabled: CHK-077 and CHK-078 (version ranges, unknown kinds refused with a named diagnostic).
