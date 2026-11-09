### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the delivered PRs do not serve ([A47](../../decisions.md#a47)), each with the PR that brings it. It reads only the operations the target entry's `operations` filter keeps (ADR 0011): a form that no kept operation carries is neither generated nor refused.

| Waits for | What |
|---|---|
| a consumer that needs them | form, multipart, download and redirect bodies (ADR 0012 bodies table, a multipart body counted on the raw stream as it arrives), refused by name as on every Node target: the reference contract carries none; a sort key a right restricts (`paging.sortKey.right.unsupported`), as on the PHP targets |
| after 1.0 | Spring Boot 3.x (refused, not waiting); WebFlux; servlet containers other than Tomcat, which Boot 4 also supports (Jetty) but no consumer proves; asynchronous handler signatures; `hooks: vendored` ([A40](../../decisions.md#a40)); every IR form absent from the reference contract's golden IRs |
