### Matrix and dependencies

The compatibility matrix gains the `client` link with its style `fetch`, provided by `codegen-fetch`, and for `codegen-react` React 19, `@tanstack/react-query` 5 (5.90 or later: the mutation callbacks' context carries the `QueryClient`), `swr` 2, and `@reduxjs/toolkit` 2 (2.6 or later, for infinite queries) with `react-redux` 9, each tested by its consumer; React 18 is recorded untested, a warning (ADR 0009). The library chosen by `query` and React are peer dependencies; the generated code imports the linked client, the front runtime copy, and that library only.
