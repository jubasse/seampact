### Errors the handler answers

A handler answers any code its operation lists through a typed error result that the target generates per operation, and the boundary renders it in the operation's wire format. That covers the codes declared or attached on the route and its nodes (`tasks.locked`), and the derived roles only the application can decide: `notFound` on a member route, whose id may not exist and that no scope reads (ADR 0006 section 5), and `stateConflict` for a stale version. In TypeScript, for illustration:

```ts
return { error: 'tasks.locked', params: { lockedBy: lock.userId } };   // typed from updateTask's error union
```

A handler may instead throw the generated exception of a code, one class per code with its typed params in the constructor, named with ADR 0007's `error` role (`TasksLockedError`; the per-operation error result takes the `errors` role, `UpdateTaskErrors`), which is the idiom of NestJS (`HttpException` with an `errorCode`), Spring, Laravel, Symfony and API Platform (`ProblemExceptionInterface`). A target offers the form its language favours, or both. Java targets declare the operation's error exceptions on the interface method, which keeps the compile-time check; PHP targets declare them with `@throws`, for static analysis. A code the operation does not list is a type error where the language can tell, and at run time a 500, as for a hook's undeclared denial.

`owner: caller` (ADR 0002 section 6) derives a 404 for another caller's id, but the boundary cannot know who owns a record. No hook is added for it: the handler, or the optional record loader above, answers the `notFound` role with that typed result. The generated test helper checks the declared 404 (SCN-004).
