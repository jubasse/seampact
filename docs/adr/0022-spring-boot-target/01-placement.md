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
  - restricted input fields and principal bindings (a sort key a right restricts is refused at generation, see "Waits for");
  - then the idempotency claim or replay.
  A refusal or a replay is written by the boundary, and `preHandle` returns `false`. It runs its steps on the `REQUEST` dispatch only, since Spring calls `preHandle` again on an `ASYNC` dispatch (spike). It first checks that the handler Spring chose is a `HandlerMethod` carrying the operation that the raw path matched ("Routes"). On a contract route, any other handler (a router function, an app `HttpRequestHandler`) answers 500, and so does a contract handler reached on a `FORWARD` or `INCLUDE` dispatch, which the filter does not see.
- **The argument resolver**, a `HandlerMethodArgumentResolver` that hands the validated input record to the method. It claims parameters of the api's generated input types only, and answers 500 when the interceptor did not validate the input.
- **The reply handler**, a `HandlerMethodReturnValueHandler` placed first in `RequestMappingHandlerAdapter`'s list. It runs step 10 on the value of a method carrying a composed annotation, and writes the reply.
- **The exception resolver**, a `HandlerExceptionResolver` placed first with `extendHandlerExceptionResolvers`.
- **The registration**: one `@Configuration(proxyBeanMethods = false)` class per api, the hook beans' lookup, the boot check, and the Spring Security beans of "Native security layers".

The generated types go into the `package` option (no default: ADR 0010 "Namespaces"). The Spring placement goes into its `spring` sub-package. The boundary runtime is not generated: the code imports `io.github.jubasse.seampact.springboot.runtime` from `seampact-spring-runtime` (ADR 0025). A declared schema `UpdateTask` and the annotation `@UpdateTask` therefore never share a package, as ADR 0007 section 7 keeps names apart in TypeScript. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name (`TasksSeampactConfiguration`, `TasksSecurityMatchers`). Constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: a sealed interface whose arms are one record per declared success status and the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, one class per code, declared on the interface method (ADR 0012 "Errors the handler answers"). The interface is synchronous. Blocking handlers scale with Boot's virtual threads (`spring.threads.virtual.enabled`), and download bodies return their stream form (ADR 0012 bodies table).

A decide hook that throws Spring Security's `AccessDeniedException` answers the requirement's first declared denial code. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").
