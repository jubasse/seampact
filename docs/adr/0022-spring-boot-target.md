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

- **Per operation, a composed annotation** named by the operation in Pascal case (`@UpdateTask`). It carries `@RequestMapping` with the method and the full contract path, and the operation id and access kind as attributes that the boot check, the security matchers and `nativeDocs` read. It carries no `@ResponseStatus`: when a method that has one returns `null`, Spring marks the request handled and runs no return value handler (`ServletInvocableHandlerMethod`), so the reply handler would never see it. Under `nativeDocs`, springdoc reads the statuses from `@ApiResponse`. `@AliasFor` exposes nothing that changes the route.
- **The boundary filter**, a `FilterRegistrationBean` at order `OrderedFilter.REQUEST_WRAPPER_FILTER_MAX_ORDER - 10001` (`-10001`): after Boot's `CharacterEncodingFilter` and observation filter, before its request-wrapper filters (`HiddenHttpMethodFilter` at `-10000`, `FormContentFilter` at `-9900`) and Spring Security's chain (`-100`). It is registered for the `REQUEST` and `ASYNC` dispatches and runs step 1:
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
  A refusal or a replay is written by the boundary, and `preHandle` returns `false`. It runs its steps on the `REQUEST` dispatch only, since Spring calls `preHandle` again on an `ASYNC` dispatch (spike). It first checks that the handler Spring chose is a `HandlerMethod` carrying the operation that the raw path matched ("Routes"). On a contract route, any other handler (a router function, an app `HttpRequestHandler`) answers 500, and so does a contract handler reached on a `FORWARD` or `INCLUDE` dispatch, which the filter does not see.
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

The filter matches the raw request target against the contract templates: `getRequestURI()` without the request's own `getContextPath()`, read on each request, then without the servlet path, stripped as a raw prefix, never through the decoded `getServletPath()`. Behind a proxy, `ForwardedHeaderFilter` applies `X-Forwarded-Prefix` to the context path of each request, so routing stays right. The boot check compares a configured `mount` with the configured paths; without one, an app under a context path or a servlet path starts, since the filter strips both from each request. The interceptor then compares the operation of the handler method Spring chose with that match. Tomcat decodes and normalizes the path before routing, so the two can differ:

- `/v1/tasks/%73earch` reaches the `search` method while the raw path matches `{p1}`. The interceptor answers the path's `notFound` 404 before any check, as on Hono.
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the filter, before Spring Security, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash, `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, and a segment holding a `;` path parameter, which Tomcat strips before routing.
- `catchAll: false` leaves those paths to the app. A base path shared with another api of the app is left to the app.
- `%2F` in a segment, a `\`, and a malformed percent-encoding never reach a filter: Tomcat answers its own 400 page. These are outside the boundary and listed in Consequences. The docs tell users not to loosen the Tomcat connector's `relaxedPathChars` and `encodedSolidusHandling`, which change what reaches the raw-path match.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and Tomcat drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the filter, where Spring would answer 405 with `Allow`, or 200 for `OPTIONS`.
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's own CORS setup, which Spring answers (spike).

### The reply path

The reply handler writes every contract reply:

- with `setStatus`, `setHeader` and the output stream, its body serialized by the boundary's own Jackson 3 `JsonMapper`, never the app's `HttpMessageConverter`s or mapper bean;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

An item, table or list body goes out in its format's success envelope (ADR 0002 section 13), `{ data: $payload }` under `pack:laravel`, the payload itself under a bare format, as the Node and PHP targets write it; the ETag is the enveloped body's. Generation refuses an envelope that does not write `$payload` under named members (`format.success.envelope.unsupported`), a slot beside the payload, the status and the path (`format.success.slot.unsupported`), a success format header (`format.success.headers.unsupported`) and the format's meta members (`format.meta.unsupported`).

Content negotiation is not consulted. A client's `Accept` changes nothing that the contract does not say.

The value goes through the same handler after an asynchronous dispatch, since Spring hands the dispatch's concurrent result to the same list (spike).

### Exceptions on contract routes

The exception resolver answers, in the api's format:

- the generated contract exceptions;
- `AuthenticationException` and Spring Security's `AccessDeniedException`, with the role of their status (401, 403), when an app component throws them inside the MVC dispatch;
- `CsrfException`, with the `csrfInvalid` role.

It returns `null` for every other exception, so the app's own `@ExceptionHandler` methods, `@ControllerAdvice` classes and Spring's resolvers answer, untouched. Their reply is checked below. An exception that no resolver answers leaves `DispatcherServlet` and reaches the boundary filter ("The outgoing response check"). A refusal whose status the operation does not declare is a 500. An app's own advice renders a contract error with the exported `renderContractError(request, response, exception)`.

### The outgoing response check

The filter wraps the response of each contract route in a checking wrapper. Every byte of the reply goes through it, from whatever writer:

- the reply handler;
- an app `@ControllerAdvice`;
- Spring Security's entry point and access-denied handler;
- a `StreamingResponseBody` written on a task thread;
- an asynchronous dispatch.

On an `ASYNC` dispatch, Spring passes its own `LifecycleHttpServletResponse` down the chain rather than the wrapper. The filter therefore finds the wrapper through a request attribute, and completes the check when the last dispatch returns without starting another (spike). The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's:

- **A declared success** passes chunk by chunk.
  - The wrapper flushes when the writer flushes. Spring Framework 7 ignores `flush()` on a `StreamingResponseBody`'s stream unless the flag `spring.http.response.flush.enabled` is `true`, with or without the wrapper (spike). Since Framework 7.0.6 it is a `SpringProperties` flag, read by `ServletServerHttpResponse`: a JVM system property (`-D`) or a classpath `spring.properties`, never Boot's `application.properties`.
  - The target does not set that flag. The download docs show both ways to set it.
- **An undeclared status** is a violation as soon as the first byte or the commit shows it; nothing has reached the client.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first. A `br` error body, which the JDK cannot decode, is a violation; ADR 0016 decodes it, a parity gap listed in Consequences.
- **`sendError`, and an empty refusal**: a 401, 403 or 429 set with `setStatus` that ends with no body byte is mapped like `sendError`. Under `strict`, neither reaches the container's error page or Boot's `/error`:
  - 401, 403 and 429 answer their role's reply in the api's format when the operation declares that status, keeping the headers already set (`WWW-Authenticate`);
  - any other status is checked as an error without a body, a violation.
  `sendError` covers Spring Security's `AccessDeniedHandlerImpl`, its firewall's `RequestRejectedException` handler, and Spring MVC's 405, 406 and 415. The empty refusal covers `HttpStatusEntryPoint`, and the resource server's `BearerTokenAuthenticationEntryPoint` and `BearerTokenAccessDeniedHandler`, which call `setStatus` only.
- **A reply the boundary did not author.** The interceptor marks the requests it admits, the reply handler the replies it writes, and the exception resolver every exception it sees, those it leaves to the app's resolvers included. On a contract route:
  - a success status (a 2xx or a 304) that the reply handler did not write is a violation as soon as its first byte or the commit shows it: a handler that wrote to the response itself, or a router function, an actuator endpoint or an app `HandlerMapping` that took the route;
  - once the interceptor admitted the request, a reply that completes with neither the reply handler's nor the exception resolver's mark is a violation. The reply handler treats a `null` value as a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). An app's `ShallowEtagHeaderFilter` ordered inside the boundary filter is therefore stripped; one ordered before it fails the boot check.

An exception that escapes `chain.doFilter`, on the `REQUEST` or the `ASYNC` dispatch of a contract route, is caught by the filter and never reaches the container. Before the commit, the filter writes the api's 500 and calls `onUnexpectedError` with it; after the commit, it fails as a stream does below. The filter is therefore not registered for the `ERROR` dispatch.

Under `strict` a violation is replaced by the api's 500 when the response is not committed, and `onUnexpectedError` is called. A failure after the commit (a stream whose writer throws after its first bytes) cannot be replaced: it is logged, `onUnexpectedError` is called and the connection is closed. Under `warn` the reply goes out as written, and the violation is logged once.

Until a consumer needs streamed bodies, the wrapper holds every reply whole in memory, success included, and an error body is neither bounded by `MAX_CHECKED_ERROR_BODY_BYTES` nor decoded from `gzip` or `deflate`: such a body fails the check as not JSON.

The limits are those of ADR 0016: a writer that bypasses the response (the raw socket) is not seen. A reply that an app filter ordered before the boundary filter writes is not seen either; the boot check refuses such a filter only for `ShallowEtagHeaderFilter`, `FormContentFilter`, `HiddenHttpMethodFilter` and Spring Security's chain.

### Errors raised before the boundary

Before the boundary filter, only the container and filters ordered before it run:

- Tomcat's own 400 for the raw paths of "Routes".
- The boot check refuses Spring Security's chain ordered before the boundary filter: its `spring.security.filter.order` must be greater than the boundary's order, `-10001`. It refuses a `FormContentFilter` or a `HiddenHttpMethodFilter` ordered before it, since the first reads a form-typed `PUT`, `PATCH` or `DELETE` body whole, past the route's limit, and the second changes `getMethod()`.
- An app filter ordered before the boundary must not read the body, change the method or write: its reply goes out unchecked. The README says to order such filters after it, or to skip contract routes with `isContractRoute(request)`.

Between the filter and the interceptor, Spring Security refuses through its entry point, access-denied handler and CSRF handling. The generated handlers ("Native security layers") render those refusals in the api's format; without them, `sendError` is mapped as above.

### Types and validation

Generated value types:

- final records for objects;
- sealed interfaces for unions, with an `Unknown` arm only on input readers;
- enums;
- `Optional<T>` for an optional member, a plain reference for a required nullable one, and `seampact-hooks`'s `Field<T>` for three-state members, so `{}` and an explicit `null` stay apart (CHK-158).
- `OffsetDateTime` for a `date-time`, kept with the offset it was sent with: the boundary's own mapper does not adjust it to the context time zone, which Jackson 3 does by default.

Wire names that differ from the Java member name are carried by `@JsonProperty`, which Jackson 3 keeps in `com.fasterxml.jackson.annotation`.

Step 6 decodes path, query, headers and the held body to a Jackson 3 `JsonNode` with the boundary's own `JsonMapper`, never the app's bean (ADR 0012 "Each target places the steps"). It then runs two passes:

1. **A generated structural validator** walks the tree and carries every rule of the contract, so a request gets every issue at once: `required`, `type` (no coercion), `unknownKeys`, `enum`, `oneOf`, the discriminator and every value rule. The value rules whose Jakarta meaning differs from the contract's keep the contract's meaning:
   - string lengths in code points, where `@Size` counts UTF-16 units;
   - `pattern` as an ECMA-262 search, where `@Pattern` matches the whole string;
   - `format`;
   - `multipleOf`.
   An opaque value takes any JSON, but a number past the range of a double anywhere inside it is a `type` issue, as on the PHP targets.
   Each issue carries its `{ in, pointer, rule }` from the tree, and the issues are bounded by `MAX_RENDERED_ISSUES = 100`.
2. **The boundary's own `JsonMapper` binds** the tree to the input record. After the structural pass the binding cannot fail; a failure is a 500.

Pass 1 runs the normalised pattern of ADR 0003 section 9 on `java.util.regex` with `find()`, `^` and `$` written `\A` and `\z` and astral escapes in Java's `\x{...}` form, so it searches as ECMA-262 does.

The boundary runs no Bean Validation pass: a second pass would only repeat pass 1's rules. The records keep the standard constraints whose meaning is the contract's (`@Min`, `@Max`, `@DecimalMin` and `@DecimalMax` with `inclusive`, `@Size` on arrays and maps, `@NotNull`, `@Valid`), for the app's own `@Valid`; the app adds a Jakarta Validation provider only for that use.

### Query and bounded values

- **Query.** Decoded from the raw `getQueryString()` by the IR's wire form, with form decoding (`+` is a space), never from `getParameter`. Zero body bytes is no body. The media type is matched exactly.
- **Body limit.** The filter refuses a declared `Content-Length` above the route's limit before reading. It decodes `gzip` and `deflate` with the JDK, counts both the encoded and the decoded bytes while reading, and answers the route's 413 as soon as either passes the limit (spike).
  - Any other content coding answers 415; a corrupt compressed body is the client's 400.
  - The bytes are replayed to Spring, unchanged, through a request wrapper, so signed routes find their raw bytes without app setup.
  - No app-wide parser limit is involved, and the target exports no limit constant.
- **Paging.** The paging roles, `overLimit` included, are validated in step 6, before any `Pageable` is built (ADR 0012 obligations). `Pageable` and `Page` appear only for the `springPage` style of the `pack:spring` profile (ADR 0008), never as a default shape. Under that style the input record holds the `Pageable` the boundary builds from the validated paging query, injected at binding, and the handler answers Spring Data's `Page`, from which the boundary reads the page facts. The `Pageable` holds the page index as an `int`, so a page number whose index passes 2147483647 is one `api.schema_invalid` issue, rule `maximum`, at the page parameter, though the derived parameter has no maximum. Each sort key reaches the `Pageable` as the Java member of the item member it names (else the Java member a member of that name would take), since the entity's property is that member; a key that yields no Java name is refused at generation.
- **Keys.** The throttle bucket key and the idempotency key are fixed-size SHA-256 digests with the same bytes, hex and base64url text as the Node targets, so keys and ETags are equal across targets. The idempotency key is derived as ADR 0012 obligations say, never from the credentials.
- **Version tokens.** The boundary validates the expected version with the body; the handler compares it with the stored version and answers the operation's `stateConflict` error, as on the Node targets. Spring has no channel for the Node targets' "left to the handler" warnings, so the Spring guide says it.
- **Absolute URLs.** Under `api.wire.urls: absolute`, every URL starts with the configured public origin, the property `seampact.<api>.public-origin`. The boot check fails without it, and the request `Host` and forwarded headers are never read. The origin is a scheme, host and port, and stays as configured behind a proxy.

### Redaction

`toString()` of every generated record and exception is generated, since a record's default `toString()` prints every component (spike). It never shows:

- `AuthenticateRequest.credentials()`;
- `csrfToken()`;
- the members of each identity's generated credentials record;
- a signed request's body, raw and parsed (the `body` of a signed route's input record), and its signature header;
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

The registration uses no `@Profile` or `@ConditionalOnProperty` to change behaviour: AOT and native builds fix conditions at build, so they behave as the JVM build does. Run-time settings are the `seampact.<api>.*` properties above.

### The boot check

The boot check runs in a `SmartInitializingSingleton`, before the server starts (spike). It reads `RequestMappingHandlerMapping`, every `HandlerMapping` bean ordered before it (`RouterFunctionMapping` at `-1`, the actuator's at `-100`, the app's own) and the context, lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- the hook problems of ADR 0016's list;
- a contract operation without a bound handler (no mapped method carries its composed annotation), or with two;
- a mapping ordered before `RequestMappingHandlerMapping` that serves a contract method and path, which would take the route from the contract handler; a mapping that cannot list its routes is left to the run-time rule of "A reply the boundary did not author";
- a mapping that no composed annotation registered and that `frameworkRoutes` does not allow-list (FR-25):
  - springdoc's paths read from its own properties (`springdoc.api-docs.path`, `/v3/api-docs` and `/v3/api-docs.yaml` by default, and the UI's paths) are accepted while `frameworkDocs` is `keep` (ADR 0011 "Which OpenAPI documents exist"); under `off` they are a problem whose fix names the generated properties file;
  - Boot's error path (`server.error.path`, `/error`) is accepted as the container's error target; a contract route reaches it only under `warn`, by a `sendError` the boundary let through;
- a configured `mount` that differs from `server.servlet.context-path` followed by `spring.mvc.servlet.path`, both read from the environment; without a `mount` nothing is compared;
- the boundary filter not ordered before Spring Security's chain, or a `ShallowEtagHeaderFilter`, `FormContentFilter` or `HiddenHttpMethodFilter` ordered before it;
- a servlet container other than Tomcat ("Refused by name or waiting") or a reactive application;
- a Spring Boot major other than 4, read from `SpringBootVersion`; `generate` already refuses 3.x from the build's resolved version.

`artefacts.bootCheck: { handlers, frameworkRoutes }` switches those two checks apart (ADR 0011).

### Native security layers

With `springSecurity` on, the target generates Spring Security 7 beans in their own class, so an app without Spring Security never compiles against it. Without the key, the plugin sets `springSecurity` from the app's compile classpath (on when `spring-security-web` is there); the generator stays a pure function of the IR and the entry (ADR 0015 "Generate is pure"). `springSecurity: false` turns it off. The beans:

- `TasksSecurityMatchers`: one `RequestMatcher` per access kind (public, optional, identity, signed), plus the optional-auth routes with `onRefused: anonymous` (ADR 0012 "Native security layers"). Each matches by the operation the boundary filter matched for the request, read with `SeampactBoundary.operationIdOf`, so the matchers agree with the boundary's most-specific match: a public template `/v1/things/{id}` never covers its identity literal sibling `/v1/things/mine`, and the servlet path, decoding, dot segments and `HEAD` are the boundary's. Per-route path patterns would match both siblings, and a `permitAll` on the template would serve the literal with no authentication. The boot check keeps the boundary filter ordered before Spring Security's chain, which these matchers need.
- `SecurityRefusals`, one bean that is the `AuthenticationEntryPoint` and the `AccessDeniedHandler`, the CSRF refusal included (a `CsrfException` in that handler, the `csrfInvalid` role). It answers in the api's format with the role of the operation the request matches, and a role the operation does not declare is the api's 500, as in the exception resolver. Outside the api's routes it answers as Spring Security's defaults, with `sendError`. The app wires it in its own chain (`exceptionHandling`, `httpBasic`, `oauth2ResourceServer`); the guide shows it. The configuration class `TasksSecurityConfiguration` holds the beans and is imported by the api's boundary configuration.
- Opt-in, with `springSecurity: { matchers: true }` (A42): a `Customizer<HttpSecurity>` bean. Spring Security 7 applies it to every `HttpSecurity` before the app's own rules (spike). It permits the public, optional-auth and signed routes: a signed call carries no credential Spring Security knows, and the boundary checks its signature. It is ordered `Ordered.HIGHEST_PRECEDENCE`, since Spring Security 7 leaves the order among `Customizer<HttpSecurity>` beans undefined without `@Order`, so it also runs before the app's own customizers. It adds `authorizeHttpRequests` to every chain, so a chain that had no authorization rules denies the requests none of its rules matches; the guide says so. A `BearerTokenResolver` would tie the security class to the resource server module, so none is generated: the app's resolver returns no token on the `onRefused: anonymous` matcher, which keeps those routes out of the bearer filter; the guide shows it.

Spring Security answers the hooks as application code, with no adapter package in 1.0 (ADR 0012 "Optional adapters"). The interceptor runs after the filter chain, so an authenticate hook reads the `Authentication` from `SecurityContextHolder`, and a decider delegates to the app's `AuthorizationManager` or `PermissionEvaluator` bean; the README shows both. On an optional-auth route with `onRefused: anonymous`, the app either excludes the route from the bearer filter with the matchers above or verifies the token inside its authenticate hook.

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
| springdoc annotations on contract routes (`@Operation` with the id, docs and successes; the `input` parameter hidden) | off | `artefacts.nativeDocs: true` |
| springdoc's own document | kept | `frameworkDocs: off`, written as `springdoc.api-docs.enabled=false` in a generated `seampact-<api>.properties` on the resources root the plugins add, which the app loads with `spring.config.import` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ handlers, frameworkRoutes }` |
| `Pageable` and `Page` | never by default | the contract's `springPage` paging style |

The error format is the api's declared format; `ProblemDetail` is used only when the api declares `application/problem+json`.

### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and validators in Java, since no JVM provider exists in 1.0. A link on its entry fails `generate` with `link.kind.not-consumed`, naming the entry and the link. It generates no client: the consumer's suite drives the routes over HTTP, and a Java client waits for a consumer that needs one.

### What the generated code depends on

At compile and run time:

- Spring Framework 7.0.6 or later (`spring-webmvc`), the matrix's floor for the flush flag of "The outgoing response check", Spring Boot 4 (`FilterRegistrationBean`, configuration properties, `SpringBootVersion`) and Jakarta Servlet 6.1;
- the Jakarta Validation 3.1 API, for the records' constraints;
- Jackson 3 (`tools.jackson.core:jackson-databind`) and `jackson-annotations`;
- `seampact-hooks`;
- Spring Security 7 in the security class only, and `io.swagger.v3.oas.annotations` under `nativeDocs` only.

The boundary runtime is copied into `spring.runtime` with the generated header, as the Node targets copy theirs (ADR 0015 "Runtime helpers"). Generated code never imports Jackson 2, which springdoc 3 brings to the classpath for swagger-core (spike), nor Kotlin. Bytecode and sources target Java 21, compiled and tested on 21 and 25 ([A13](../decisions.md#a13)).

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the delivered PRs do not serve ([A47](../decisions.md#a47)), each with the PR that brings it. It reads only the operations the target entry's `operations` filter keeps (ADR 0011): a form that no kept operation carries is neither generated nor refused.

| Waits for | What |
|---|---|
| a consumer that needs them | form, multipart, download and redirect bodies (ADR 0012 bodies table, a multipart body counted on the raw stream as it arrives), refused by name as on every Node target: the reference contract carries none; a sort key a right restricts (`paging.sortKey.right.unsupported`), as on the PHP targets |
| after 1.0 | Spring Boot 3.x (refused, not waiting); WebFlux; servlet containers other than Tomcat, which Boot 4 also supports (Jetty) but no consumer proves; asynchronous handler signatures; `hooks: vendored` ([A40](../decisions.md#a40)); every IR form absent from the reference contract's golden IRs |

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/spring-boot/`. It holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a Logback appender. It reads the template's credentials from the shared JSON. A Gradle and a Maven build root each copy it to `$RUNNER_TEMP`; the Gradle root takes the plugin and `seampact-hooks` from the repository's `jvm/` build, included by path, and the compiler binary the workflow built. The `allow-listed-framework-route` boot variant runs on a second jar, built from a config that allow-lists its route.

The workflow `p6-spring-boot.yml` has five jobs:

- `changes`;
- `compiler-binary` (Node), which builds the linux-x64 binary;
- `build`, a matrix whose first step fails when `node`, `npm` or `npx` is found. It builds the app with each plugin on JDK 21 and 25 from the reference contract's bundle, served over https by `java Serve.java`, and on JDK 25 from the local `path` source ("Every operation" below);
- `http-suite`, which starts `java -jar` and runs the `default`, `hand-written` and `boot` profiles, plus `pack:spring` on a third jar built with `@seampact/pack-spring`, through the suite's CLI (ADR 0015 "Suite profiles"), with the boot profile run as `command: java`;
- `spring-boot`, the aggregate, failing on any failed or cancelled job.

The proof is:

- the `node`-absent step;
- a green suite row per build tool and JDK;
- the consumer's JUnit `GeneratedRedactionTest` (one record of each kind of "Redaction" holding a known secret, which must be absent while `[redacted]` is present) and `SecurityRefusalsTest` (Spring Security's 401, 403 and CSRF refusal in the api's format, and a public route the customizer lets through a chain that requires authentication; the reference contract declares no optional-auth operation and no public template beside a literal route, so the generator's golden checks run the matchers in a Spring Security chain on routes of every access kind, and springdoc on the `nativeDocs` and `frameworkDocs: off` output);
- the plugins lane's `identical-files` diff of both plugins' output.

Suite cases that wait for a later PR carry a refusal naming that PR; the list is empty at spring-4.

**Every operation.** From spring-3 the app config's spring-boot entries serve every operation of the reference contract, with no `operations` filter. No other fixture is added.

### Delivery

| PR | Delivers |
|---|---|
| spring-1 | the generator in `jvm/seampact-spring-boot` (Kotlin, Palantir JavaPoet pinned): `SpringBootTarget.generate(ir, entry)`, the options, types, records with redacted `toString()`, interfaces, composed annotations, results and exceptions; `SpringBootOptionsTest` and `SpringBootGoldenTest`, whose golden is compiled by `javac` on 21 and 25 against Spring Boot 4, and whose redaction case checks the `toString()` of one golden record of each kind of "Redaction" |
| spring-2 | the filter, interceptor, argument resolver, reply handler, exception resolver, outgoing check, hook beans and boot check; the sample app; the suite CLI; the Gradle rows of the workflow, on the core-path operations |
| spring-3 | paging, idempotency replay, throttle, cache and ETag headers, concurrency, rule proofs, restricted input fields, signed routes, absolute URLs, the `pack:spring` profile, `GeneratedRedactionTest`, the boot check rules of mappings, mount and container, the ECMA-262 pattern search; the entries' filter dropped |
| spring-4 | the Spring Security beans and customizer, `nativeDocs`, `frameworkDocs: off` through both plugins, the `springSecurity` default read from the compile classpath, `SecurityRefusalsTest`; form, multipart, download and redirect bodies stay refused by name until a consumer needs them |

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

- An app keeps its controllers, its Jackson mapper, its validator, its advice and its Spring Security chain. On contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The check order holds in Spring without app setup: Spring's binding and `@Valid` never decide a contract input.
- Every reply on a contract route is checked, from whichever writer, streams and asynchronous dispatches included. A Spring Security refusal that the app did not wire to the generated handlers, by `sendError` or by an empty `setStatus` (the resource server's defaults), still answers in the api's format for 401 and 403.
- Streamed downloads stream at the writer's pace only with Spring's flush flag set (`-D` or `spring.properties`); the boundary neither sets nor needs it.
- Tomcat's own 400 for `%2F`, `\` and malformed percent-encodings stays outside the api's format; the Node targets pass such a value to step 6 instead. Loosening `relaxedPathChars` or `encodedSolidusHandling` is not supported.
- A `br` error body is a violation here, where ADR 0016 decodes it.
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
