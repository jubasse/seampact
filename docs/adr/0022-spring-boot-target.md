# ADR 0022: The Spring Boot server target

Status: accepted

## Context

ADR 0012 fixes what every server target generates around the developer's controller, places the spring-boot steps in its target table and lists the spring-boot obligations. ADR 0016 fixes, for the Node server targets, the rules this target meets in Java: the check order, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the body limit, query decoding and the bounded values. `seampact-spring-boot` (ADR 0010 "Native artifacts") generates, per api of the app config, Java that places those checks around the developer's `@RestController` classes in a Spring Boot servlet application. Both build plugins call it, and the app builds on a machine without Node ([A9](../decisions.md#a9)). This ADR states where each step runs in Spring, how each obligation is met, what the developer can turn off, and what waits. What it does not restate holds as ADR 0016 says.

Five Spring behaviours shape the placement:

- Spring MVC binds handler arguments (`@RequestBody` through the app's Jackson mapper, then `@Valid`) after the `HandlerInterceptor`s run, so a check placed on the arguments sees the app's binding, not the contract's.
- Spring Security is a servlet filter chain that refuses before `DispatcherServlet`.
- The container (Tomcat) normalizes and decodes the path before any filter and refuses some raw paths itself.
- Exceptions go to an ordered list of `HandlerExceptionResolver`s, the controller's own `@ExceptionHandler` methods before any `@ControllerAdvice`.
- A reply may be written after the handler returns: on another thread (`StreamingResponseBody`), or in a second, asynchronous dispatch (`CompletableFuture`, `DeferredResult`).

## Options

- Spring Boot majors: Boot 4.x only (Spring Framework 7, Jackson 3, Spring Security 7, Jakarta EE 11), or Boot 3.5 as well. Choice: 4.x only; Boot 3.5's open-source support ended on 2026-06-30, and a second major would double the Jackson and Security code paths. Boot 3.x is recorded as incompatible in the compatibility matrix, so `generate` refuses it by name (ADR 0009 "Artefacts and the compatibility matrix", ADR 0011 rules).
- Where steps 2 to 8 run: in the servlet filter, in a `HandlerInterceptor`, or in `@PreAuthorize` and `@Valid`. Choice: the interceptor; it runs after Spring Security and before argument binding (spike), so the access steps see the app's `Authentication`, and nothing the app's mapper or validator does changes the contract input (ADR 0012 "The check order", FR-19). `@PreAuthorize` and `@Valid` run after binding.
- Step 1 and the outgoing check: in the interceptor and a `ResponseBodyAdvice`, or in a servlet filter ordered before Spring Security. Choice: the filter; only a filter sees the raw path and the raw body, and only a response wrapper installed before Spring Security sees Spring Security's own refusals and the replies the app's advice writes (spike). A `ResponseBodyAdvice` sees only bodies written by a message converter.
- Reply path: a `ResponseBodyAdvice` that rewrites the value, or a `HandlerMethodReturnValueHandler` placed first. Choice: the return value handler; content negotiation runs before any advice, so an `Accept: text/plain` request on a JSON route is a 406 that the advice never sees, while the handler writes the contract's reply with the boundary's own mapper (spike). This replaces the `ResponseBodyAdvice` of ADR 0012's target table.
- Exceptions on contract routes: a `@ControllerAdvice`, or a `HandlerExceptionResolver` placed first. Choice: the resolver; a controller's own `@ExceptionHandler(Exception.class)` takes an exception before any advice, so an advice would lose the contract's exceptions to it (spike). This replaces the `@ControllerAdvice` of ADR 0012's target table.
- Validation in step 6: Bean Validation on bound records only, every check generated, or a generated structural pass with Bean Validation for value constraints. Choice: the generated structural pass, then Bean Validation for the value constraints whose Jakarta meaning is the contract's, with generated constraints where it differs ("Types and validation" below). Binding first stops at the first type error and coerces a number to a string, and `@Size` and `@Pattern` differ from the contract's lengths and patterns (spike). The annotations stay because they are what Spring developers and springdoc read.
- Boot check timing: on `ContextRefreshedEvent`, or in a `SmartInitializingSingleton`. Choice: `SmartInitializingSingleton`; Tomcat already listens when `ContextRefreshedEvent` fires, while a `SmartInitializingSingleton` runs once every bean, `RequestMappingHandlerMapping` included, is built, before the server starts (spike).

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| Placement | [0022-spring-boot-target/01-placement.md](0022-spring-boot-target/01-placement.md) |
| Routes | [0022-spring-boot-target/02-routes.md](0022-spring-boot-target/02-routes.md) |
| The reply path | [0022-spring-boot-target/03-the-reply-path.md](0022-spring-boot-target/03-the-reply-path.md) |
| Exceptions on contract routes | [0022-spring-boot-target/04-exceptions-on-contract-routes.md](0022-spring-boot-target/04-exceptions-on-contract-routes.md) |
| The outgoing response check | [0022-spring-boot-target/05-the-outgoing-response-check.md](0022-spring-boot-target/05-the-outgoing-response-check.md) |
| Errors raised before the boundary | [0022-spring-boot-target/06-errors-raised-before-the-boundary.md](0022-spring-boot-target/06-errors-raised-before-the-boundary.md) |
| Types and validation | [0022-spring-boot-target/07-types-and-validation.md](0022-spring-boot-target/07-types-and-validation.md) |
| Query and bounded values | [0022-spring-boot-target/08-query-and-bounded-values.md](0022-spring-boot-target/08-query-and-bounded-values.md) |
| Redaction | [0022-spring-boot-target/09-redaction.md](0022-spring-boot-target/09-redaction.md) |
| Options and registration | [0022-spring-boot-target/10-options-and-registration.md](0022-spring-boot-target/10-options-and-registration.md) |
| The boot check | [0022-spring-boot-target/11-the-boot-check.md](0022-spring-boot-target/11-the-boot-check.md) |
| Native security layers | [0022-spring-boot-target/12-native-security-layers.md](0022-spring-boot-target/12-native-security-layers.md) |
| Native access instead of hooks | [0022-spring-boot-target/13-native-access-instead-of-hooks.md](0022-spring-boot-target/13-native-access-instead-of-hooks.md) |
| What the shape-imposing features turn off with | [0022-spring-boot-target/14-what-the-shape-imposing-features.md](0022-spring-boot-target/14-what-the-shape-imposing-features.md) |
| Links and the client | [0022-spring-boot-target/15-links-and-the-client.md](0022-spring-boot-target/15-links-and-the-client.md) |
| What the generated code depends on | [0022-spring-boot-target/16-what-the-generated-code-depends.md](0022-spring-boot-target/16-what-the-generated-code-depends.md) |
| Refused by name or waiting | [0022-spring-boot-target/17-refused-by-name-or-waiting.md](0022-spring-boot-target/17-refused-by-name-or-waiting.md) |
| The consumer and the proof | [0022-spring-boot-target/18-the-consumer-and-the-proof.md](0022-spring-boot-target/18-the-consumer-and-the-proof.md) |
| Delivery | [0022-spring-boot-target/19-delivery.md](0022-spring-boot-target/19-delivery.md) |

## Spike

Run on Spring Boot 4.1.1 (Spring Framework 7.0.9, Tomcat 11.0.24), Jackson 3.1.5, Spring Security 7.1.1, Hibernate Validator 9.1.3 and springdoc-openapi 3.1.1, on Java 25, and not kept. A reduced boundary had:

- a filter at order `-200`, with a raw-path matcher, a bounded body read and a checking response wrapper;
- an interceptor, an argument resolver, a first return value handler and a first exception resolver;
- an in-memory Spring Security chain with `PathPatternRequestMatcher` rules.

Requests were sent raw with Python's `http.client` and sockets.

| Case | Result |
|---|---|
| order of the request pieces on `POST /v1/tasks` | filter, then `preHandle` decoded the body to a `JsonNode`, then the argument resolver, then the app's `RequestBodyAdvice` and `@RequestBody` |
| contract exception thrown in `preHandle`; same in a controller with its own `@ExceptionHandler(Exception.class)` | the first resolver answered both 409s; the controller's handler did not run |
| Spring Security 401 (entry point), bad credentials, `MissingCsrfTokenException` | each written through the wrapper (filter before the chain) and checked |
| `Content-Length` over the limit; chunked over the limit; gzip; gzip expanding past the limit | 413 before reading; 413 while reading; decoded and replayed to `@RequestBody`; 413 on the decoded count |
| app `@ControllerAdvice` answering an undeclared 418 `ProblemDetail`; a declared 404 in the format | 500; passed |
| `ResponseEntity<StreamingResponseBody>`, three chunks 150 ms apart | written on a `task-n` thread through the wrapper; all chunks at about 450 ms with or without the wrapper; with `spring.http.response.flush.enabled=true`, at 2, 152, 303 and 457 ms through the wrapper |
| streamed 409 in the format; streamed undeclared 206 | held and passed; 500, nothing sent before |
| `CompletableFuture` value, thrown contract exception, app advice 418, undeclared `ResponseEntity` 418 | the `ASYNC` dispatch carried Spring's `LifecycleHttpServletResponse`, the wrapper found through a request attribute, and `preHandle` called again; 200 by the reply handler, 409 by the resolver, 500, 500 |
| `Accept: text/plain` on the reply handler's route; on a converter route | 200 JSON with the strong ETag; 406 by `sendError`, held by the wrapper, 500 |
| Bean Validation on records: `@Size(max = 3)` on `"😀😀"`, `@Pattern("b")` on `"abc"`, nested member with `@JsonProperty("due_at")` | both violations (UTF-16 count, whole match); path `subs[1].dueAt`; Hibernate Validator ran with `ParameterMessageInterpolator` |
| binding `{"title":5,"subs":[{"due_at":[]}],"extra":1}`; binding `{"title":5}` | one `MismatchedInputException`, the other issues unreported; bound as `"5"` |
| `/v1/tasks/search`, `/v1/tasks/%73earch`, `/v1/tasks:batch` | the search method; the search method while the raw path matched `{id}`; the batch method |
| `/v1/tasks/7/`, `/v1//tasks/7`, `x/../7`, `%2e%2e` (without the filter's 404) | Spring's 404; the Security firewall's 400; Tomcat normalized the servlet path, the raw URI kept the dot segments |
| `/v1/tasks/a%2Fb`, `/v1/tasks\7`, `/v1/tasks/%E0%A4%A` | Tomcat's 400 HTML page before any filter |
| `/v1/tasks/7;x=1` | servlet path `/v1/tasks/7`; the Security firewall's `sendError(400)` |
| `HEAD`; `OPTIONS`; CORS preflight; `PUT` on a `GET` path (without the filter's 404) | the `GET` method, no body; 200 with `Allow`; 200 with `Access-Control-Allow-Origin` by the app's CORS mapping; 405 with `Allow` |
| `server.servlet.context-path=/api`; `spring.mvc.servlet.path=/svc` | context path `/api`, mappings and matchers unchanged; servlet path `/svc`, `withDefaults()` matchers unmatched, a protected route served unauthenticated |
| a `Customizer<HttpSecurity>` bean permitting `GET /v1/tasks/{p1}`, the app's chain requiring authentication there | applied first: the route answered 200 without credentials |
| `RequestMappingHandlerMapping` at boot | the app's mappings, springdoc's `/v3/api-docs` and `/v3/api-docs.yaml`, Boot's `/error` twice with no method |
| boot check throwing from `ContextRefreshedEvent`; from a `SmartInitializingSingleton` | "Tomcat started" logged before the failure; failed before Tomcat started, 21 mappings already read |
| default `toString()` of a record | every component shown |
| dependency tree | springdoc 3.1.1 brought Jackson 2.21 `jackson-databind` |

Read from the sources after the spike, not run: Spring Security 7.1.1's `HttpStatusEntryPoint`, `BearerTokenAuthenticationEntryPoint` and `BearerTokenAccessDeniedHandler` call `setStatus` without `sendError`; Boot 4.1.1 orders `HiddenHttpMethodFilter` at `-10000`, `FormContentFilter` (on by default) at `-9900`, `RouterFunctionMapping` at `-1` and the actuator's handler mappings at `-100`; `ServletInvocableHandlerMethod` skips the return value handlers on a `null` value when the method carries `@ResponseStatus`. The spike's `-200` order is replaced by `-10001` for that reason.

One run's first request to a non-contract streamed route failed inside Tomcat (a header `NullPointerException` during the async dispatch, with the flush property on). It was outside the boundary and did not recur.

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): Spring Boot (1.2.0): step 8b runs in `BoundaryInterceptor.preHandle` right after `IdempotencyStep.begin`, over one generated `<Operation>InputRules` bean per operation; the runtime builds the code-name to wire-pointer map.
- An app keeps its controllers, its Jackson mapper, its validator, its advice and its Spring Security chain. On contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The check order holds in Spring without app setup: Spring's binding and `@Valid` never decide a contract input.
- Every reply on a contract route is checked, from whichever writer, streams and asynchronous dispatches included. A Spring Security refusal that the app did not wire to the generated handlers, by `sendError` or by an empty `setStatus` (the resource server's defaults), still answers in the api's format for 401 and 403.
- Streamed downloads stream at the writer's pace only with Spring's flush flag set (`-D` or `spring.properties`); the boundary neither sets nor needs it.
- Tomcat's own 400 for `%2F`, `\` and malformed percent-encodings stays outside the api's format; the Node targets pass such a value to step 6 instead. Loosening `relaxedPathChars` or `encodedSolidusHandling` is not supported.
- A `br` error body is a violation here, where ADR 0016 decodes it.
- Under `bodyValidation` the handler-result body is validated here (a 500 under `strict`, a log under `warn`), where ADR 0016 never validates it.
- A trailing slash, `//`, a dot segment or a `;` path parameter under a base path answers the api's 404, as on the Node targets.
- Security matchers follow the servlet path; an app that sets `spring.mvc.servlet.path` needs no change.
- Behind a reverse proxy, the app sets `server.forward-headers-strategy`: `framework` (`ForwardedHeaderFilter`, which applies `X-Forwarded-Prefix` by default in Boot 4.1) or `native` (Tomcat's `RemoteIpValve`, no prefix). The edge proxy removes the forwarded headers a caller sends, so none is forged. The Spring guide says both.
- Bean Validation annotations stay on the records, with seampact's own constraints where Jakarta's meaning differs, so a developer's `@Valid` agrees with the boundary.
- Boot 3.x apps cannot use the target in 1.0.
- ADR 0012's spring-boot row is amended: a first return value handler and a first exception resolver replace its `ResponseBodyAdvice` and `@ControllerAdvice`, for the reasons in Options, and the composed annotation carries no `@ResponseStatus`.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, controllers stay the developer's), FR-19 (spring-boot check placement), FR-25 (framework routes), FR-35 (the shared suite); CHK-158, CHK-168; amendments A9, A13, A30, A36, A39, A40, A41, A42, A43, A47.
- ADRs: 0007 (Java names), 0008 (`pack:spring`), 0009 (artefacts, matrix), 0010 (artifacts, namespaces), 0011 (app config, framework docs), 0012 (placement and obligations), 0013 (raw body), 0015 (runtime copies, golden tests, suite profiles), 0016 and 0020 (the shared obligations and the placement this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Spring Boot consumer.
