### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and rules in PHP, since no PHP provider exists in 1.0. A link on its entry fails `generate` with `link.kind.not-consumed`, naming the entry and the link. It generates no client: the consumer's suite drives the routes over HTTP, and a PHP client waits for a consumer that needs one.
