# ADR 0012: Neutral access hooks

Status: accepted

## Context

Authentication, rights, roles and tenancy are unopinionated, even at the cost of less generated code (amendment [A25](../decisions.md#a25)). The contract declares what a route requires: an identity and its principal schema, requirements (rights and rules) with typed params and a subject, tenancy scopes, and the errors each can raise. It never says how a credential is checked, how a right is decided or how a tenant is found. Applications keep the libraries they already use: Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates and Policies, Symfony Voters, Spring Security, or hand-written code (A25). seampact adapts to the framework's own mechanisms and never replaces them ([A30](../decisions.md#a30)).

Early research proposed mapping each right onto each framework's native authorization mechanism inside the target. A25 overrides that: targets generate neutral hooks only, and native mappings are optional adapter packages. Rights stay flexible ([A20](../decisions.md#a20)), a restricted input field is rejected or stripped by configuration ([A21](../decisions.md#a21)), and tenancy is open ([A23](../decisions.md#a23)). 1.0 ships the CASL and spatie adapters ([A24](../decisions.md#a24)).

Rights, rules, scopes and identities are declared with the grammar of ADR 0002 and recorded in the IR of ADR 0004. This ADR decides the runtime boundary every server target generates from them.

## Options

- Map each right onto the framework's native authorization inside the target (`#[IsGranted]`, `@PreAuthorize`, policies), as the rights research proposed; generate neutral typed hooks, with native mappings as optional adapters; or generate nothing for access. Choice: neutral hooks (A25), with native access as an opt-in setup ([A42](../decisions.md#a42), "Native access instead of hooks" below). A native mapping imposes one library per framework, and generating nothing leaves deny by default and the check order unenforced at the boundary.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| One neutral, typed hook per concern | [0012-access-hooks/01-one-neutral-typed-hook-per.md](0012-access-hooks/01-one-neutral-typed-hook-per.md) |
| Your controller, the generated utilities around it | [0012-access-hooks/02-your-controller-the-generated-utilities.md](0012-access-hooks/02-your-controller-the-generated-utilities.md) |
| Registration and per-right overrides | [0012-access-hooks/03-registration-and-per-right-overrides.md](0012-access-hooks/03-registration-and-per-right-overrides.md) |
| The boot check | [0012-access-hooks/04-the-boot-check.md](0012-access-hooks/04-the-boot-check.md) |
| The check order | [0012-access-hooks/05-the-check-order.md](0012-access-hooks/05-the-check-order.md) |
| Restricted fields | [0012-access-hooks/06-restricted-fields.md](0012-access-hooks/06-restricted-fields.md) |
| Errors the handler answers | [0012-access-hooks/07-errors-the-handler-answers.md](0012-access-hooks/07-errors-the-handler-answers.md) |
| Open tenancy | [0012-access-hooks/08-open-tenancy.md](0012-access-hooks/08-open-tenancy.md) |
| Custom metadata | [0012-access-hooks/09-custom-metadata.md](0012-access-hooks/09-custom-metadata.md) |
| Optional adapters | [0012-access-hooks/10-optional-adapters.md](0012-access-hooks/10-optional-adapters.md) |
| Native security layers | [0012-access-hooks/11-native-security-layers.md](0012-access-hooks/11-native-security-layers.md) |
| Native access instead of hooks | [0012-access-hooks/12-native-access-instead-of-hooks.md](0012-access-hooks/12-native-access-instead-of-hooks.md) |
| Target obligations | [0012-access-hooks/13-target-obligations.md](0012-access-hooks/13-target-obligations.md) |
| Failures inside hooks | [0012-access-hooks/14-failures-inside-hooks.md](0012-access-hooks/14-failures-inside-hooks.md) |

## Consequences

- Each target generates less than a native mapping would (no `#[IsGranted]`, `@PreAuthorize` or policy registration), and the application or an adapter writes a few lines of glue. In return no target imposes a library, a right naming scheme or a tenancy scheme. An app that prefers its framework's native access keeps it, with seampact's metadata, at the cost of the principal-dependent checks.
- No target owns a controller: the developer's controller stays the developer's, and regenerating never touches it (A41).
- The same HTTP suite proves every target, because every target exposes the same three hooks.
- The check order is a contract fact. A framework whose natural order differs (Spring's argument validation, NestJS guards before pipes) is adapted by the generated code, not by the application.
- The CASL and spatie adapters show how to write an adapter; community adapters follow the same hooks package.

## Traceability

- History: the dated amendments this ADR carried until PR #451 are folded into the sections they changed; `git show 43055be4:docs/adr/0012-access-hooks.md` holds them with their dates.
- FRs: FR-4, FR-5, FR-16 (controllers stay the developer's, A41), FR-19 (spring-boot check placement), FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-41, FR-10 (metadata reaches the boundary); amendments [A18](../decisions.md#a18), A20, A21, A23, A24, A25, A30, A39, A40, A41, A42, [A43](../decisions.md#a43).
- Checklist items enabled: CHK-004, CHK-006, CHK-007 (identities, variants, CSRF), CHK-014 (order and boot refusal), CHK-015, CHK-016 (throttle bucket and proof reach the hook), CHK-017, CHK-018, CHK-019, CHK-020, CHK-025, CHK-033, CHK-062, CHK-063, CHK-086, CHK-087, CHK-090, CHK-091, CHK-092, CHK-093, CHK-094, CHK-096, CHK-097, CHK-098, CHK-099, CHK-116 (no second 404 for a scoped id), CHK-117 (no field rights on a relay route); CHK-131, CHK-133, CHK-147, CHK-150 to CHK-158, CHK-161 to CHK-164, CHK-168, CHK-169; CHK-170 (framework document routes in the boot check), CHK-174 (symfony, api-platform, adonis and fastify step placement).
- Success metric: SM-8.
