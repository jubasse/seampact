### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and constraints in PHP. A link on its entry is refused by the runner with `link.kind.not-consumed`, naming the entry and the link, before any generator runs: no link reaches the generator. It generates no client.
