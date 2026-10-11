# ADR 0013: Inbound signed webhooks

Status: accepted

## Context

Inbound signed webhooks are in v1, minimal (amendment A5). A third-party caller, such as a payment provider or a media server, has no user token; it proves itself by signing the request with a shared secret. The first consumer is a Stripe-style scheme: a header carrying a timestamp and an HMAC-SHA256 of `"{timestamp}.{raw body}"`, a five-minute tolerance, and a raw body requirement (`.work/arthome-research.md` section 14).

Authentication stays neutral (A25, ADR 0012): the generated boundary must not force a verification implementation on the application. FR-20 asks for a signed identity kind, a declared scheme, and an optional runtime helper that implements the scheme behind the authenticate hook, with test vectors computed by an independent tool.

The keywords are defined by the grammar (ADR 0002). YAML below is illustration only, syntax per ADR 0002.

## Decisions

### A signed identity kind with a declared scheme

A signed identity is an identity like any other: deny by default still applies, and its routes resolve to it. Its scheme declares:

| Field | v1 values | Meaning |
|---|---|---|
| name | a header name | where the signature travels, as `name` does for a header scheme |
| format | a template with `{ts}` and `{sig}` | how the header value is laid out |
| algorithm | `hmac-sha256` | the MAC; the IR enum is open for later algorithms |
| payload | a template with `{ts}` and `{rawBody}` and literal text | the bytes that are signed |
| encoding | `hex` or `base64` | how the MAC is written in the header |
| tolerance | a duration | maximum distance between the signed timestamp and now; required when the format has `{ts}`, refused otherwise |
| key | `{ value: <literal> }` (one fixed key id), or `{ from: <path, query or header source> }` | the key id the application's secret lookup receives, to choose the secret set |

```yaml
# illustration, syntax per ADR 0002 section 9
schemes:
  stripeSignature:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }
identities:
  paymentProvider:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller
```

Header parsing is fixed by the format:
- A format made of comma-separated `name={placeholder}` items is parsed as comma-separated `name=value` pairs. The pair bound to `{sig}` may repeat; each value is a candidate signature, which supports secret rotation. Pairs whose name is not in the format are ignored (Stripe's `v0`, for example). The `{ts}` pair must appear exactly once and be a whole number of Unix seconds.
- A format made of a literal prefix and `{sig}` (`sha256={sig}`) is parsed by removing the prefix.
- A header that is missing or does not parse answers 401 at once; the authenticate hook is not called.

Outbound webhooks, vendor presets (`preset: stripe`) and schemes without a signature are out of v1 (FR-20). The real media-server hook may carry no signature at all; that would be a new scheme kind, added through the open IR enum without a breaking change (ADR 0005).

### What the compiler derives

On every route whose identity is signed (FR-20):
- the raw body is required: the IR marks the operation so every target captures the exact request bytes before any parsing;
- the CSRF companion and the idempotency key are not derived;
- 401 is derived for a missing, malformed, stale or wrong signature, with `derivedFrom` naming the identity;
- a cookie scheme cannot be combined with a signed identity (compile error).

The body is still validated against the route's input schema after authentication, in the normal check order (ADR 0012).

### Where the verification happens

The generated boundary captures the raw body, parses the signature header and calls the identity's authenticate hook with the raw bytes and the parsed fields (timestamp, candidate signatures, and the key id from the scheme's `key`). The hook answers the principal or the declared 401. The boundary does not verify the MAC itself, because the secret store and the policy (one secret, several during rotation, one per tenant) belong to the application.

Each ecosystem has an optional helper that implements the declared scheme behind the hook: `@seampact/signed-webhooks` (npm, every Node server target), `io.github.jubasse:seampact-signed-webhooks` (JVM) and `seampact/signed-webhooks` (Composer). The application gives it a secret lookup, from key id to the list of currently valid secrets; the helper never stores a secret. It:
1. rebuilds the signed payload from the template, using the raw bytes exactly as received;
2. computes the MAC with each valid secret;
3. decodes each candidate signature with the declared encoding; a candidate that does not decode, or has the wrong length, fails;
4. compares in constant time (`crypto.timingSafeEqual`, `MessageDigest.isEqual`, `hash_equals`); one match passes;
5. refuses when the distance between the timestamp and now exceeds the tolerance, in either direction; the clock is injectable for tests.

Raw body capture uses each framework's own facility (A30): the `rawBody` option in NestJS, a buffer content-type parser on the route in Fastify, `express.raw` on the route in Express, `request.raw()` in AdonisJS, a byte-array body in the generated Spring controller, `getContent()` in Laravel and Symfony. No middleware may re-serialize the body before capture.

### Test vectors

Computed with OpenSSL 3.5.5 (`openssl dgst -sha256 -hmac`) and cross-checked with Python's `hmac` module. The conformance fixtures copy them, and the helper of every ecosystem must pass them.

GitHub style: header `X-Hub-Signature-256`, format `sha256={sig}`, payload `{rawBody}`, encoding `hex`, no timestamp, no tolerance.

| Case | Secret | Raw body | Header value | Expected |
|---|---|---|---|---|
| G1, GitHub's documented example | `It's a Secret to Everybody` | `Hello, World!` | `sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17` | pass |
| G2 | `gh_seampact_test_secret` | `{"action":"opened","number":42}` | `sha256=60f99ef5bf52ed71ae5ab6f27fea3ece3d3f13c005df9f86248a9ac97890dd4f` | pass |
| G3 | `gh_seampact_test_secret` | `{"action":"opened","number":42}` | G1's header value | 401 |

Stripe style: header `Stripe-Signature`, format `t={ts},v1={sig}`, payload `{ts}.{rawBody}`, tolerance 300 seconds. Body B is `{"id":"evt_1","type":"invoice.paid"}`, timestamp 1700000000, current secret `whsec_seampact_test_secret`, previous secret `whsec_seampact_old_secret`. The MAC of `1700000000.` followed by B is:
- with the current secret: hex `fbd2303da6c6da3155ac8e7058bc71b4b632453f52358c644d19db2e0399752c`, base64 `+9IwPabG2jFVrI5wWLxxtLYyRT9SNYxkTRnbLgOZdSw=`;
- with the previous secret: hex `374e421c1bf3c3e16acd9d2def2110ed3abf293ac2ff4608f660008c51d4b651`.

| Case | Valid secrets | Now | Header value | Body | Expected |
|---|---|---|---|---|---|
| S1 | current | 1700000100 | `t=1700000000,v1=fbd2303d...9752c` | B | pass |
| S2, base64 encoding declared | current | 1700000100 | `t=1700000000,v1=+9IwPabG2jFVrI5wWLxxtLYyRT9SNYxkTRnbLgOZdSw=` | B | pass |
| S3, stale | current | 1700000301 | as S1 | B | 401 |
| S4, future | current | 1699999600 | as S1 | B | 401 |
| S5, tampered body | current | 1700000100 | as S1 | B with `invoice.paid` changed to `invoice.void` (its true MAC would be `29f83d11adca74141bdf868caa64c5b24eb4522246c67d55f5ab7b6808f33274`) | 401 |
| S6, rotation | current | 1700000100 | `t=1700000000,v1=374e421c...4b651,v1=fbd2303d...9752c` | B | pass |
| S7, rotation, old secret still valid | previous | 1700000100 | as S6 | B | pass |
| S8, only the old signature | current | 1700000100 | `t=1700000000,v1=374e421c...4b651` | B | 401 |
| S9, extra `v0` pair ignored | current | 1700000100 | `t=1700000000,v0=deadbeef,v1=fbd2303d...9752c` | B | pass |
| S10, malformed | current | 1700000100 | `t=abc,v1=fbd2303d...9752c` | B | 401, hook not called |
| S11, missing header | current | 1700000100 | none | B | 401, hook not called |

Signatures shortened with `...` in the table are the full values listed above.

## Consequences

- A signed webhook route is declared like any route and gets the same boundary, check order and HTTP suite cases.
- An application that already verifies signatures with a vendor SDK keeps doing so inside its authenticate hook; the helper is optional.
- The raw body requirement constrains each target's body handling on these routes only.
- A scheme beyond HMAC over a template (asymmetric signatures, no signature with a network allow-list) needs a new scheme kind, which the open IR enum allows without a breaking change.

## Traceability

- FRs: FR-20, FR-25 (verification behind the authenticate hook), FR-16 (signed webhooks in every server target), FR-35 (suite cases); amendments A5, A25, A30.
- Checklist item enabled: CHK-073 (a bad or stale signature answers 401 before the handler, with a raw body and no CSRF or idempotency key).
