### The shared query plan and front runtime

`@seampact/codegen-core` gains a framework-neutral query plan, computed once per api from the IR and the client descriptor, that every front renderer reads:

- per operation, its form: a query for a `safe` operation, plus an infinite query when its paging style allows one (below), or a mutation for any other operation;
- the names for each export: the operation's base name from ADR 0007, plus the affixes this ADR adds (`Options`, `InfiniteOptions`, `MutationOptions`, `use`), as in `listTasksOptions`, `useListTasks`, `listTasksInfiniteOptions`, `createTaskMutationOptions`; two exports of one module with the same name are refused by name (`names.collision`), with the operation ids;
- the key segments, the resource type, the next-page rule and the call options the operation needs (a required timeout);
- the request header member of the idempotency key, when the operation has one.

A front runtime is copied into each front target's output with the generated header, as the server runtime is (ADR 0009 "What generated code depends on at run time"). It normalises a request into a key, builds the next page's request from the page facts, holds one idempotency key per mutation attempt chain, turns a `result`-style client's error result into the `ContractError` the client would have thrown (`toContractError`, which an RTK user also calls on the plain error to get the typed class back), and turns success headers into a plain record (below). It imports no Node built-in and no framework.
