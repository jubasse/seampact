### Failures inside hooks

- A hook may throw the generated exception of one of its declared codes, as a handler may. A framework's own denial exception thrown inside a decide hook (Laravel's `AuthorizationException` from `Gate::authorize()`, Symfony's `AccessDeniedException` from `denyAccessUnlessGranted()`, Spring Security's `AccessDeniedException`) answers the requirement's first declared denial code, so an idiomatic decider body works as written. A route requirement's denial that hides the record (Laravel's `Response::denyAsNotFound()`) answers the operation's `notFound` code instead when the operation declares one (a field right keeps its own code), so the reply does not reveal that the record exists.
- Any other exception thrown or rejected by a hook produces 500 with the error logged; it never counts as allow.
- A denial naming a code the requirement did not declare produces 500: the contract would otherwise be broken silently.
- A hook result is exclusive: the three hook results (decide, authenticate, resolve scope) carry one arm each, and a result with both arms or with neither produces 500, since the hook's answer would be ambiguous.
- Timeouts and retries inside a hook are the application's concern.
