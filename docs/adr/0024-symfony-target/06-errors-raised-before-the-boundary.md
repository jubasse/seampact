### Errors raised before the boundary

Before the `kernel.request` listener, only the web server, PHP, the Runtime and `DebugHandlersListener` run: the web server's body limit (nginx `client_max_body_size`), PHP's `post_max_size`, and a failure while the kernel boots. The boot check requires the boundary's listeners at their priorities.

Between step 1 and the `kernel.controller` listener, `ValidateRequestListener` (conflicting forwarded headers, a 400), the session, the app's own `kernel.request` listeners, the router and the firewall run. The router's 404 and 405 never answer a contract path, which step 1 has already matched or refused. The firewall's refusals, an authenticator's failure included, and the others' exceptions are mapped as "Exceptions on contract routes" says; a refusal the mapping does not name is checked as written.
