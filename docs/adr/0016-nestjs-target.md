# ADR 0016: The NestJS server target

Status: accepted

## Context

ADR 0012 fixes what every server target generates around the developer's controller and lists, under "Target obligations", what each target's own ADR must state. `@seampact/codegen-nestjs` is the first server target built, for the end-to-end slice ([A47](../decisions.md#a47)): it generates, for each api of the app config, the boundary around the developer's `@Controller()` classes, validating with its `validators` link: a Standard Schema provider (`codegen-zod`, `codegen-yup`) or `codegen-class-validator` (ADR 0009 "The provider seam", "Validators" below).

NestJS is a layer over an HTTP platform, Express by default, and three of its behaviours shape the placement. A route has a fixed status that NestJS re-applies when it writes the reply, so an interceptor cannot choose the status. Exceptions go to one filter each, chosen by scope. And everything that happens before routing (body parsing, an unknown route) is outside every route-scoped mechanism. This ADR states where each step of ADR 0012's check order runs in NestJS, how each obligation is met, and what the target refuses by name or leaves for later. The Fastify and Express targets reuse the same request checks through `@seampact/server-runtime` and cite this ADR for the shared obligations instead of restating them.

## Options

- Platform under NestJS: Express only in the slice, or Express and Fastify together. Choice: Express, NestJS's default; Fastify under NestJS comes right after the slice, since its raw-body and reply handling differ and would double the riskiest glue.
- Reply path: the boundary writes status, headers and body itself, or it hands a value to NestJS and turns off Express's ETag with `app.set('etag', false)`. Choice: the boundary writes the reply; turning ETags off app-wide would change the app's own routes ([A36](../decisions.md#a36)), and NestJS would still re-apply the route status.
- Raw body for signed routes: a boot check that refuses to start without `rawBody: true`, a generated startup helper, or a per-request check with documented setups. Choice: the per-request check, fail closed, and an opt-in generated `verify` function; NestJS exposes no public way to read the parser setup at boot, and the app keeps its own `main.ts` (A36).
- Handler refusals: a typed returned error, a typed thrown exception, or both. Choice: both (ADR 0012 "Errors the handler answers"), the returned error in the slice and the thrown exception right after it.
- Placement of steps 6 to 8: in a seampact interceptor, at the end of the seampact guard, or in a seampact pipe on the operation's input param. Choice: the pipe ("The NestJS stages"); NestJS runs a param's own pipes after every app pipe, so validation is NestJS's pipe role and no app pipe changes what the contract validates, at the cost of one awaited pipe chain per request, measured and accepted there.
- Placement of step 10 and the write: a seampact interceptor around the handler, or a wrapper of the controller method. Choice: the wrapper by default ("The NestJS stages"), since NestJS runs any route with an interceptor through a per-request path of its own that costs about half a baseline request and, on 12.1.x, leaks native memory; and, opt-in, a global seampact reply interceptor (target option `reply: interceptor`) for an app whose global interceptors shape replies.
- Exceptions on contract routes: a seampact filter that catches every exception there, or one that catches only seampact's own while the app's filters handle the rest. Choice: the narrow filter, since NestJS gives each exception to exactly one filter and a catch-all would hide the app's own; the contract is then enforced on the outgoing response, whoever wrote it.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| Placement | [0016-nestjs-target/01-placement.md](0016-nestjs-target/01-placement.md) |
| Validators | [0016-nestjs-target/02-validators.md](0016-nestjs-target/02-validators.md) |
| The reply path | [0016-nestjs-target/03-the-reply-path.md](0016-nestjs-target/03-the-reply-path.md) |
| Exceptions on contract routes | [0016-nestjs-target/04-exceptions-on-contract-routes.md](0016-nestjs-target/04-exceptions-on-contract-routes.md) |
| The outgoing response check | [0016-nestjs-target/05-the-outgoing-response-check.md](0016-nestjs-target/05-the-outgoing-response-check.md) |
| Errors raised before routing | [0016-nestjs-target/06-errors-raised-before-routing.md](0016-nestjs-target/06-errors-raised-before-routing.md) |
| Target options | [0016-nestjs-target/07-target-options.md](0016-nestjs-target/07-target-options.md) |
| Raw body | [0016-nestjs-target/08-raw-body.md](0016-nestjs-target/08-raw-body.md) |
| Body limit, query and bounded values | [0016-nestjs-target/09-body-limit-query-and-bounded.md](0016-nestjs-target/09-body-limit-query-and-bounded.md) |
| Handler results | [0016-nestjs-target/10-handler-results.md](0016-nestjs-target/10-handler-results.md) |
| Registration | [0016-nestjs-target/11-registration.md](0016-nestjs-target/11-registration.md) |
| The boot check | [0016-nestjs-target/12-the-boot-check.md](0016-nestjs-target/12-the-boot-check.md) |
| What the generated code depends on | [0016-nestjs-target/13-what-the-generated-code-depends.md](0016-nestjs-target/13-what-the-generated-code-depends.md) |
| Refused by name or waiting | [0016-nestjs-target/14-refused-by-name-or-waiting.md](0016-nestjs-target/14-refused-by-name-or-waiting.md) |
| Left to the handler | [0016-nestjs-target/15-left-to-the-handler.md](0016-nestjs-target/15-left-to-the-handler.md) |
| The NestJS stages | [0016-nestjs-target/16-the-nestjs-stages.md](0016-nestjs-target/16-the-nestjs-stages.md) |
| Writing the app around the boundary | [0016-nestjs-target/17-writing-the-app-around-the.md](0016-nestjs-target/17-writing-the-app-around-the.md) |

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): NestJS: step 8b runs in the generated wrapper before the handler (`nestjs.ts`), with `inputRules` in `SeampactModuleOptions`; a class-validator constraint that injects a provider is listed in the app's own module.
- An app keeps its `main.ts`, its global pipes, guards, interceptors and filters; on contract routes the boundary's checks and reply win, and its own routes are unchanged, Express ETags included. A cache interceptor must skip contract routes with `isContractRoute(context)`, or the app does not start. Any app interceptor on a contract route brings back NestJS's per-request interceptor path there: its CPU cost, and on NestJS 12.1.x its native-memory growth, which 12.2.0 cures; the interceptor mode puts every route of the app on that path.
- Every reply on a contract route is written by generated code, so NestJS features that shape the reply (a global serializer interceptor) do nothing there, and the boot check refuses those that would write it again (`@Redirect`, `@Render`, `@Sse`, a developer `@Res()`) or that would be ignored (`@HttpCode`, `@Header`).
- App filters keep working on contract routes; under `strict`, a reply of theirs outside the contract becomes a 500, and under `warn` a logged violation.
- Refusals raised before routing are in the api's format only when the app registers the exported global filter or calls its helper; the README's NestJS setup shows both.
- A raw-body or parser-limit setup error answers 500 on the routes it affects, with a log naming the fix, instead of refusing to start.
- The Fastify and Express targets reuse the shared request checks and cite this ADR for the obligations; only their placement is new.

## Traceability

- History: the dated amendments this ADR carried until PR #451 are folded into the sections they changed; `git show 43055be4:docs/adr/0016-nestjs-target.md` holds them with their dates.
- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A30, A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body and signature header).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the NestJS consumer.
