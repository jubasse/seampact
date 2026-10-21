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

### Placement

The developer writes `@RestController` classes implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`). Each method carries its operation's composed annotation and takes the operation's input record:

```java
@RestController
class TasksController implements TasksEndpoints {
  @UpdateTask
  public UpdateTaskResult updateTask(UpdateTaskInput input) throws TasksLockedError { ... }
}
```

Codegen emits, per api, under the target entry's `out` and the `package` option:

- **Per operation, a composed annotation** named by the operation in Pascal case (`@UpdateTask`). It carries `@RequestMapping` with the method and the full contract path, and the operation id and access kind as attributes that the boot check, the security matchers and `nativeDocs` read. It also carries `@ResponseStatus` with the first declared success status, for springdoc only; the reply path writes every status. `@AliasFor` exposes nothing that changes the route.
- **The boundary filter**, a `FilterRegistrationBean` ordered before Spring Security's filter chain. It is registered for the `REQUEST` and `ASYNC` dispatches and runs step 1:
  - the request context;
  - the raw-path match of "Routes" below;
  - the media type;
  - the bounded body read;
  - the outgoing response check.
  It answers its own refusals in the api's format.
- **The interceptor**, a `HandlerInterceptor` on the api's contract routes, which runs steps 2 to 8:
  - authenticate, principal requirements, scopes and requirements;
  - step 6 on the decoded body;
  - restricted input fields, sort keys and principal bindings;
  - then the idempotency claim or replay.
  A refusal or a replay is written by the boundary, and `preHandle` returns `false`. It runs on the `REQUEST` dispatch only, since Spring calls `preHandle` again on an `ASYNC` dispatch (spike). It first checks that the handler method Spring chose carries the operation that the raw path matched ("Routes").
- **The argument resolver**, a `HandlerMethodArgumentResolver` that hands the validated input record to the method. It claims parameters of the api's generated input types only, and answers 500 when the interceptor did not validate the input.
- **The reply handler**, a `HandlerMethodReturnValueHandler` placed first in `RequestMappingHandlerAdapter`'s list. It runs step 10 on the value of a method carrying a composed annotation, and writes the reply.
- **The exception resolver**, a `HandlerExceptionResolver` placed first with `extendHandlerExceptionResolvers`.
- **The registration**: one `@Configuration(proxyBeanMethods = false)` class per api, the hook beans' lookup, the boot check, and the Spring Security beans of "Native security layers".

The generated types go into the `package` option (no default: ADR 0010 "Namespaces"). The Spring placement goes into its `spring` sub-package, and the copied runtime into `spring.runtime`. A declared schema `UpdateTask` and the annotation `@UpdateTask` therefore never share a package, as ADR 0007 "Amendment 2026-10-19: generated modules" keeps names apart in TypeScript. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name (`TasksSeampactConfiguration`, `TasksSecurityMatchers`). Constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: a sealed interface whose arms are one record per declared success status and the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, one class per code, declared on the interface method (ADR 0012 "Errors the handler answers"). The interface is synchronous. Blocking handlers scale with Boot's virtual threads (`spring.threads.virtual.enabled`), and download bodies return their stream form (ADR 0012 bodies table).

A decide hook that throws Spring Security's `AccessDeniedException` answers the requirement's first declared denial code. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

### Routes

Patterns use `PathPatternParser` syntax with positional variable names (`/v1/tasks/{p1}`), which the boundary never reads. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `*` (`path.segment.literal.unsupported`);
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Fastify and Hono.

Spring orders patterns by specificity, so `/v1/tasks/search` wins over `/v1/tasks/{p1}` whatever the declaration order.

The filter matches the raw request target: `getRequestURI()` without the context path and the servlet path, against the contract templates. The interceptor then compares the operation of the handler method Spring chose with that match. Tomcat decodes and normalizes the path before routing, so the two can differ:

- `/v1/tasks/%73earch` reaches the `search` method while the raw path matches `{p1}`. The interceptor answers the path's `notFound` 404 before any check, as on Hono.
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the filter, before Spring Security, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash, `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, and a segment holding a `;` path parameter, which Tomcat strips before routing.
- `catchAll: false` leaves those paths to the app. A base path shared with another api of the app is left to the app.
- `%2F` in a segment, a `\`, and a malformed percent-encoding never reach a filter: Tomcat answers its own 400 page. These are outside the boundary and listed in Consequences.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and Tomcat drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the filter, where Spring would answer 405 with `Allow`, or 200 for `OPTIONS`.
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's own CORS setup, which Spring answers (spike).

### The reply path

The reply handler writes every contract reply:

- with `setStatus`, `setHeader` and the output stream, its body serialized by the boundary's own Jackson 3 `JsonMapper`, never the app's `HttpMessageConverter`s or mapper bean;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

Content negotiation is not consulted. A client's `Accept` changes nothing that the contract does not say.

The value goes through the same handler after an asynchronous dispatch, since Spring hands the dispatch's concurrent result to the same list (spike).

### Exceptions on contract routes

The exception resolver answers, in the api's format:

- the generated contract exceptions;
- `AuthenticationException` and Spring Security's `AccessDeniedException`, with the role of their status (401, 403), when an app component throws them inside the MVC dispatch;
- `CsrfException`, with the `csrfInvalid` role.

It returns `null` for every other exception, so the app's own `@ExceptionHandler` methods, `@ControllerAdvice` classes and Spring's resolvers answer, untouched. Their reply is checked below. A refusal whose status the operation does not declare is a 500. An app's own advice renders a contract error with the exported `renderContractError(request, response, exception)`.

### The outgoing response check

The filter wraps the response of each contract route in a checking wrapper. Every byte of the reply goes through it, from whatever writer:

- the reply handler;
- an app `@ControllerAdvice`;
- Spring Security's entry point and access-denied handler;
- a `StreamingResponseBody` written on a task thread;
- an asynchronous dispatch.

On an `ASYNC` dispatch, Spring passes its own `LifecycleHttpServletResponse` down the chain rather than the wrapper. The filter therefore finds the wrapper through a request attribute, and completes the check when the last dispatch returns without starting another (spike). The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's:

- **A declared success** passes chunk by chunk.
  - The wrapper flushes when the writer flushes. Spring Framework 7 ignores `flush()` on a `StreamingResponseBody`'s stream unless the Spring property `spring.http.response.flush.enabled` is `true`, with or without the wrapper (spike).
  - The target does not set that property. The download docs show it.
- **An undeclared status** is a violation as soon as the first byte or the commit shows it; nothing has reached the client.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first.
- **`sendError`** on a contract route never reaches the container's error page or Boot's `/error`:
  - 401, 403 and 429 answer their role's reply in the api's format when the operation declares that status;
  - any other status is checked as an error without a body, a violation.
  This covers Spring Security's default `HttpStatusEntryPoint` and `AccessDeniedHandlerImpl`, its firewall's `RequestRejectedException` handler, and Spring MVC's 405, 406 and 415.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). An app's `ShallowEtagHeaderFilter` ordered inside the boundary filter is therefore stripped; one ordered before it fails the boot check.

Under `strict` a violation is replaced by the api's 500 when the response is not committed, and `onUnexpectedError` is called. A failure after the commit (a stream whose writer throws after its first bytes) cannot be replaced: it is logged, `onUnexpectedError` is called and the connection is closed. Under `warn` the reply goes out as written, and the violation is logged once.

The limits are those of ADR 0016: a writer that bypasses the response (the raw socket) is not seen. A reply that an app filter ordered before the boundary filter writes is not seen either; the boot check refuses such a filter only for `ShallowEtagHeaderFilter` and Spring Security's chain.

### Errors raised before the boundary

Before the boundary filter, only the container and filters ordered before it run:

- Tomcat's own 400 for the raw paths of "Routes".
- The boot check refuses Spring Security's chain ordered before the boundary filter: its `spring.security.filter.order` must be greater than the boundary's order, `-200`.
- An app filter ordered before the boundary writes unchecked. The README says to order such filters after it, or to skip contract routes with `isContractRoute(request)`.

Between the filter and the interceptor, Spring Security refuses through its entry point, access-denied handler and CSRF handling. The generated handlers ("Native security layers") render those refusals in the api's format; without them, `sendError` is mapped as above.

### Types and validation

Generated value types:

- final records for objects;
- sealed interfaces for unions, with an `Unknown` arm only on input readers;
- enums;
- `Optional<T>` for an optional member, a plain reference for a required nullable one, and `seampact-hooks`'s `Field<T>` for three-state members, so `{}` and an explicit `null` stay apart (CHK-158).

Wire names that differ from the Java member name are carried by `@JsonProperty`, which Jackson 3 keeps in `com.fasterxml.jackson.annotation`.

Step 6 decodes path, query, headers and the held body to a Jackson 3 `JsonNode` with the boundary's own `JsonMapper`, never the app's bean (ADR 0012 "Each target places the steps"). It then runs one pass:

1. **A generated structural validator** walks the tree: `required`, `type` (no coercion), `unknownKeys`, `enum`, `oneOf` and the discriminator. It also covers the value rules whose Jakarta meaning differs from the contract's:
   - string lengths in code points, where `@Size` counts UTF-16 units;
   - `pattern` as an ECMA-262 search, where `@Pattern` matches the whole string;
   - `format`;
   - `multipleOf`.
   Each issue carries its `{ in, pointer, rule }` from the tree.
2. **The boundary's own `JsonMapper` binds** the tree to the input record. After the structural pass the binding cannot fail; a failure is a 500.
3. **Bean Validation checks the record** with the boundary's own `ValidatorFactory` (Hibernate Validator 9, `ParameterMessageInterpolator`, the copied `Field<T>` value extractor), never the app's `Validator` bean. Records carry the standard constraints whose meaning is the contract's: `@Min`, `@Max`, `@DecimalMin` and `@DecimalMax` with `inclusive`, `@Size` on arrays and maps, `@NotNull`. Generated constraints with their validators in the copied runtime carry the rules of pass 1, so a developer's own `@Valid` on a record checks the same rules.
4. **Issues are joined.** A violation's property path (`subs[1].dueAt`) maps to the wire pointer (`/subs/1/due_at`) through a table generated per record. `rule` is the contract keyword, read from the constraint's annotation type, never its message. Issues are bounded by `MAX_RENDERED_ISSUES = 100`.

The app needs a Jakarta Validation provider on its runtime classpath (`spring-boot-starter-validation`); without one, the boot check fails, naming the starter.

### Query and bounded values

- **Query.** Decoded from the raw `getQueryString()` by the IR's wire form, with form decoding (`+` is a space), never from `getParameter`. Zero body bytes is no body. The media type is matched exactly.
- **Body limit.** The filter refuses a declared `Content-Length` above the route's limit before reading. It decodes `gzip` and `deflate` with the JDK, counts both the encoded and the decoded bytes while reading, and answers the route's 413 as soon as either passes the limit (spike).
  - Any other content coding answers 415; a corrupt compressed body is the client's 400.
  - The bytes are replayed to Spring, unchanged, through a request wrapper, so signed routes find their raw bytes without app setup.
  - No app-wide parser limit is involved, and the target exports no limit constant.
- **Paging.** The paging roles, `overLimit` included, are validated in step 6, before any `Pageable` is built (ADR 0012 obligations). `Pageable` and `Page` appear only for the `springPage` style of the `pack:spring` profile (ADR 0008), never as a default shape.
- **Keys.** The throttle bucket key and the idempotency key are fixed-size SHA-256 digests with the same bytes, hex and base64url text as the Node targets, so keys and ETags are equal across targets. The idempotency key is derived as ADR 0012 obligations say, never from the credentials.
- **Absolute URLs.** Under `api.wire.urls: absolute`, every URL starts with the configured public origin, the property `seampact.<api>.public-origin`. The boot check fails without it, and the request `Host` and forwarded headers are never read.

### Redaction

`toString()` of every generated record and exception is generated, since a record's default `toString()` prints every component (spike). It never shows:

- `AuthenticateRequest.credentials()`;
- `csrfToken()`;
- the members of each identity's generated credentials record;
- a signed request's body and signature header;
- a `sensitive` member.

Each is printed as the generated `[redacted]` constant, since `seampact-hooks`'s `Redaction` is package-private (ADR 0012 obligations, CHK-168). The boundary's own logs carry the operation id, the rule and the pointer, never an input value.

### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `package`, required;
- the naming options of ADR 0007: `suffixes`, `escape`, `enumCase`, `handlers`;
- `indent` and `layout`;
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`);
- `springSecurity` ("Native security layers").

At run time, the generated configuration binds `seampact.<api>.*` Boot properties:

- `responses` and `body-validation` for the api;
- `operations.<operation-id>.responses` per operation.

An operation's property wins over the api's property, which wins over the target option.

Hooks are beans: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact-hooks` interfaces, narrowed by the generated request records, and `onUnexpectedError` is an optional bean of a generated functional interface. A decider bean names the rights and rules it serves; two beans claiming one name fail the boot check, and no default hook exists (ADR 0012 "Registration and per-right overrides"). The request context is a request attribute under a generated name (ADR 0012 "Open tenancy").

The configuration class is picked up by component scan when the `package` option is under the app's own package, or by `@Import(TasksSeampactConfiguration.class)`; registering it twice is deduplicated by Spring. A non-servlet application (WebFlux) fails the start, naming the fix, instead of skipping the boundary silently. Two apis are two configuration classes, each with its own filter, interceptor and boot check.

### The boot check

The boot check runs in a `SmartInitializingSingleton`, before the server starts (spike). It reads `RequestMappingHandlerMapping` and the context, lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- the hook problems of ADR 0016's list;
- a contract operation without a bound handler (no mapped method carries its composed annotation), or with two;
- a mapping that no composed annotation registered and that `frameworkRoutes` does not allow-list (FR-25):
  - springdoc's paths read from its own properties (`springdoc.api-docs.path`, `/v3/api-docs` and `/v3/api-docs.yaml` by default, and the UI's paths) are accepted while `frameworkDocs` is `keep` (ADR 0011 "Which OpenAPI documents exist");
  - Boot's error path (`server.error.path`, `/error`) is accepted as the container's error target, which contract routes never reach;
- a `mount` that differs from `server.servlet.context-path` followed by `spring.mvc.servlet.path`, both read from the environment;
- the boundary filter not ordered before Spring Security's chain, or a `ShallowEtagHeaderFilter` ordered before it;
- a servlet container other than Tomcat ("Refused by name or waiting"), a reactive application, or no Jakarta Validation provider;
- a Spring Boot major other than 4, read from `SpringBootVersion`; `generate` already refuses 3.x from the build's resolved version.

`artefacts.bootCheck: { handlers, frameworkRoutes }` switches those two checks apart (ADR 0011).

### Native security layers

With `springSecurity` on, the target generates Spring Security 7 beans in their own class, so an app without Spring Security never compiles against it. Without the key, the plugin sets `springSecurity` from the app's compile classpath (on when `spring-security-web` is there); the generator stays a pure function of the IR and the entry (ADR 0015 "Generate is pure"). `springSecurity: false` turns it off. The beans:

- `TasksSecurityMatchers`: one `RequestMatcher` per access kind (public, optional, identity, signed), built from `PathPatternRequestMatcher.withDefaults().basePath(<servlet path>)` with each operation's method and template (ADR 0012 "Native security layers"). The base path is read from `spring.mvc.servlet.path`: without it, under a servlet path, no matcher matches, and a route the app protects with them is served unauthenticated (spike).
- An `AuthenticationEntryPoint`, an `AccessDeniedHandler` and the CSRF refusal (a `CsrfException` in that handler, the `csrfInvalid` role). Each answers in the api's format with the role of the operation the request matches. The app wires them in its own chain (`exceptionHandling`, `httpBasic`, `oauth2ResourceServer`); the README shows it.
- Opt-in, with `springSecurity: { matchers: true }` (A42): a `Customizer<HttpSecurity>` bean. Spring Security 7 applies it to every `HttpSecurity` before the app's own rules (spike). It permits the public and optional-auth routes, and keeps the optional-auth routes with `onRefused: anonymous` out of the resource server's bearer filter through a `BearerTokenResolver` that returns no token on them.

Spring Security still refuses before the boundary. Its refusals reach the client in the api's format through the generated handlers, or through the `sendError` mapping above.

### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"):

- the target generates no hook interfaces and no steps 2 to 5;
- it exports each operation's identity, requirements and scopes as a generated `TasksAccess` table keyed by the matchers above, for the app's `AuthorizationManager`;
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.

### What the shape-imposing features turn off with

The target imposes no wire shape (A36). Each feature that adds behaviour beyond the contract has a switch:

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| the Spring Security beans | from the classpath | `springSecurity: false` |
| permitting public and optional routes in Spring Security | off | `springSecurity: { matchers: true }` |
| springdoc annotations on contract routes | off | `artefacts.nativeDocs: true` |
| springdoc's own document | kept | `frameworkDocs: off`, written as `springdoc.api-docs.enabled=false` in a generated `seampact-<api>.properties` on the resources root the plugins add, which the app loads with `spring.config.import` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ handlers, frameworkRoutes }` |
| `Pageable` and `Page` | never by default | the contract's `springPage` paging style |

The error format is the api's declared format; `ProblemDetail` is used only when the api declares `application/problem+json`.

### What the generated code depends on

At compile and run time:

- Spring Framework 7 (`spring-webmvc`), Spring Boot 4 (`FilterRegistrationBean`, configuration properties, `SpringBootVersion`) and Jakarta Servlet 6.1;
- Jakarta Validation 3.1 with a provider;
- Jackson 3 (`tools.jackson.core:jackson-databind`) and `jackson-annotations`;
- `seampact-hooks`;
- Spring Security 7 in the security class only, and `io.swagger.v3.oas.annotations` under `nativeDocs` only.

The boundary runtime is copied into `spring.runtime` with the generated header, as the Node targets copy theirs (ADR 0015 "Runtime helpers"). Generated code never imports Jackson 2, which springdoc 3 brings to the classpath for swagger-core (spike), nor Kotlin. Bytecode and sources target Java 21, compiled and tested on 21 and 25 ([A13](../decisions.md#a13)).

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the delivered PRs do not serve ([A47](../decisions.md#a47)), each with the PR that brings it:

| Waits for | What |
|---|---|
| spring-3 | paging styles; idempotency replay, throttle, cache and ETag headers; signed routes; `api.wire.urls: absolute`; the `pack:spring` profile |
| spring-4 | form, multipart, download and redirect bodies (ADR 0012 bodies table, a multipart body counted on the raw stream as it arrives); `nativeDocs`; `frameworkDocs: off`; the Spring Security beans and customizer |
| after 1.0 | Spring Boot 3.x (refused, not waiting); WebFlux; servlet containers other than Tomcat, which Boot 4 also supports (Jetty) but no consumer proves; asynchronous handler signatures; `hooks: vendored` ([A40](../decisions.md#a40)); every IR form absent from the reference contract's golden IRs |

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/spring-boot/`. It holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a Logback appender. It reads the template's credentials from the shared JSON. A Gradle and a Maven build root each copy it to `$RUNNER_TEMP` and take the seampact modules and the compiler from `mavenLocal()` (ADR 0011 "Unpublished installs").

The workflow `p6-spring-boot.yml` has five jobs:

- `changes`;
- `compiler-binary` (Node), which builds the linux-x64 binary;
- `build`, a matrix in `eclipse-temurin` containers, whose first step fails when `node`, `npm` or `npx` is found. It builds the app with each plugin from the reference contract's bundle, served over https by `java Serve.java`, on JDK 21 and 25, plus one local-YAML row per build tool on JDK 25;
- `http-suite`, which starts `java -jar` and runs the `default`, `hand-written` and `boot` profiles, plus `pack:spring` from spring-3, through the suite's CLI (ADR 0015 "Suite profiles"), with the boot profile run as `command: java`;
- `spring-boot`, the aggregate, failing on any failed or cancelled job.

The proof is:

- the `node`-absent step;
- a green suite row per build tool and JDK;
- the consumer's JUnit `GeneratedRedactionTest` (one record of each kind of "Redaction" holding a known secret, which must be absent while `[redacted]` is present) and `SecurityRefusalsTest` (Spring Security's 401, 403 and CSRF refusal in the api's format, and an optional-auth route reachable with an invalid token);
- the plugins lane's `identical-files` diff of both plugins' output.

Suite cases that wait for a later PR carry a refusal naming that PR; the list is empty at spring-4.

### Delivery

| PR | Delivers |
|---|---|
| spring-1 | the generator in `jvm/seampact-spring-boot` (Kotlin, Palantir JavaPoet pinned): `SpringBootTarget.generate(ir, entry)`, the options, types, records with redacted `toString()`, interfaces, composed annotations, results and exceptions; `SpringBootOptionsTest` and `SpringBootGoldenTest`, whose golden is compiled by `javac` on 21 and 25 against Spring Boot 4 |
| spring-2 | the filter, interceptor, argument resolver, reply handler, exception resolver, outgoing check, hook beans and boot check; the sample app; the suite CLI; the Gradle rows of the workflow |
| spring-3 | paging, idempotency replay, throttle, cache and ETag headers, signed routes, absolute URLs, the `pack:spring` profile, `GeneratedRedactionTest` |
| spring-4 | the Spring Security beans and customizer, form, multipart, download and redirect bodies, `nativeDocs`, `frameworkDocs: off`, `SecurityRefusalsTest` |

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

One run's first request to a non-contract streamed route failed inside Tomcat (a header `NullPointerException` during the async dispatch, with the flush property on). It was outside the boundary and did not recur.

## Consequences

- An app keeps its controllers, its Jackson mapper, its validator, its advice and its Spring Security chain. On contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The check order holds in Spring without app setup: Spring's binding and `@Valid` never decide a contract input.
- Every reply on a contract route is checked, from whichever writer, streams and asynchronous dispatches included. A Spring Security refusal that the app did not wire to the generated handlers still answers in the api's format for 401 and 403.
- Streamed downloads stream at the writer's pace only with Spring's flush property set; the boundary neither sets nor needs it.
- Tomcat's own 400 for `%2F`, `\` and malformed percent-encodings stays outside the api's format; the Node targets pass such a value to step 6 instead.
- A trailing slash, `//`, a dot segment or a `;` path parameter under a base path answers the api's 404, as on the Node targets.
- Security matchers follow the servlet path; an app that sets `spring.mvc.servlet.path` needs no change.
- Bean Validation annotations stay on the records, with seampact's own constraints where Jakarta's meaning differs, so a developer's `@Valid` agrees with the boundary.
- Boot 3.x apps cannot use the target in 1.0.
- ADR 0012's spring-boot row names a `ResponseBodyAdvice` and a `@ControllerAdvice`. This ADR places a first return value handler and a first exception resolver instead, for the reasons in Options.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, controllers stay the developer's), FR-19 (spring-boot check placement), FR-25 (framework routes), FR-35 (the shared suite); CHK-158, CHK-168; amendments A9, A13, A30, A36, A39, A40, A41, A42, A43, A47.
- ADRs: 0007 (Java names), 0008 (`pack:spring`), 0009 (artefacts, matrix), 0010 (artifacts, namespaces), 0011 (app config, framework docs), 0012 (placement and obligations), 0013 (raw body), 0015 (runtime copies, golden tests, suite profiles), 0016 and 0020 (the shared obligations and the placement this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Spring Boot consumer.
