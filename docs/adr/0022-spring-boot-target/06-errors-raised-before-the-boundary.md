### Errors raised before the boundary

Before the boundary filter, only the container and filters ordered before it run:

- Tomcat's own 400 for the raw paths of "Routes".
- The boot check refuses Spring Security's chain ordered before the boundary filter: its `spring.security.filter.order` must be greater than the boundary's order, `-10001`. It refuses a `FormContentFilter` or a `HiddenHttpMethodFilter` ordered before it, since the first reads a form-typed `PUT`, `PATCH` or `DELETE` body whole, past the route's limit, and the second changes `getMethod()`.
- An app filter ordered before the boundary must not read the body, change the method or write: its reply goes out unchecked. The README says to order such filters after it, or to skip contract routes with `isContractRoute(request)`.

Between the filter and the interceptor, Spring Security refuses through its entry point, access-denied handler and CSRF handling. The generated handlers ("Native security layers") render those refusals in the api's format; without them, `sendError` is mapped as above.
