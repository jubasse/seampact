---
"@seampact/compiler": patch
---

The compiler derives each operation's body limit, the api's unknown-key policy, the credential, CSRF, identity, union tag and idempotency headers (the identity ones optional on an optional-auth route), and refuses an incomplete idempotency convention, an idempotency exemption no key reaches and a derived name that clashes with another, once per authored fault.

The compiler also derives the version parameter and entity tags of a versioned write, a relayed one included, the cache of a GET with its conditional 304 and no-store on any response carrying a sensitive field, the paging parameters and page headers of each style, the deprecation, download and redirect headers and each operation's maturity, and refuses, once per authored cache, a cache without freshness or a family that is undeclared, written on a non-GET route or set on a route answering a sensitive field.

The compiler also writes the int64, output enum and URL conventions an api sets into its IR instead of refusing a non-default value, and warns about a bucket that leaves its limit or window to the server.
