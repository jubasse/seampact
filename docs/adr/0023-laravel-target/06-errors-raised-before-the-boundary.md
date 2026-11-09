### Errors raised before the boundary

Before the boundary middleware, only the web server and PHP run: the web server's body limit (nginx `client_max_body_size`), PHP's `post_max_size` for form bodies, and a fatal error during the app's boot. The boot check and the boundary's first-request assertion require the boundary first in the global stack.

Between the boundary and the access middleware, `ValidatePathEncoding`, `PreventRequestsDuringMaintenance` (503, `php artisan down`), `ValidatePostSize`, the session, CSRF, throttle and guard middleware refuse by throwing. Their replies are mapped as "Exceptions on contract routes" says; a refusal the mapping does not name is checked as written.
