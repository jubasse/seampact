### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own Pydantic models. A link on its entry fails `generate` with `link.kind.not-consumed`. It generates no client.
