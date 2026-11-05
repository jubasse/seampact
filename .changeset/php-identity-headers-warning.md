---
---

Laravel and Symfony generation now warns with `identity.headers.handler` on each operation whose identity declares headers, such as the rights-version header, since the handler owes that check, and refuses a query or HTTP Basic credential scheme by name instead of answering 500 at run time.

A PHP target must now also implement `Seampact\Ir\Run\HandlerWarningGenerator` (`handlerWarnings(ContractIR, TargetEntry)`); a target without it is refused by name.
