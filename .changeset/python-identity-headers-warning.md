---
---

FastAPI, DRF and Ninja generation now warns with `identity.headers.handler` on each operation whose identity declares headers, such as the rights-version header, since the handler owes that check, and refuses a query or HTTP Basic credential scheme by name instead of answering 500 at run time.
