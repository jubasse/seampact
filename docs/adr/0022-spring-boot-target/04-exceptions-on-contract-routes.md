### Exceptions on contract routes

The exception resolver answers, in the api's format:

- the generated contract exceptions;
- `AuthenticationException` and Spring Security's `AccessDeniedException`, with the role of their status (401, 403), when an app component throws them inside the MVC dispatch;
- `CsrfException`, with the `csrfInvalid` role.

It returns `null` for every other exception, so the app's own `@ExceptionHandler` methods, `@ControllerAdvice` classes and Spring's resolvers answer, untouched. Their reply is checked below. An exception that no resolver answers leaves `DispatcherServlet` and reaches the boundary filter ("The outgoing response check"). A refusal whose status the operation does not declare is a 500. An app's own advice renders a contract error with the exported `renderContractError(request, response, exception)`.

While Spring Boot devtools is active (read once at boot from the `devtools` property source, absent in a packaged jar and under JUnit), an exception that escapes the handler chain before the reply is committed goes to Spring's own error handling (Boot's `/error`) instead of the api's 500: the filter discards the buffered reply, releases an idempotency claim, logs the exception's message and where it was thrown, calls `onUnexpectedError` as before and rethrows it (ADR 0016 "The outgoing response check" for the Node side); a reply an app `@ExceptionHandler` or advice writes for a non-contract exception skips the violation check in debug.
