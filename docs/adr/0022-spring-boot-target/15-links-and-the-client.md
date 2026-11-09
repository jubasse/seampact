### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and validators in Java, since no JVM provider exists in 1.0. A link on its entry fails `generate` with `link.kind.not-consumed`, naming the entry and the link. It generates no client: the consumer's suite drives the routes over HTTP, and a Java client waits for a consumer that needs one.
