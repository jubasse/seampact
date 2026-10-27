---
---

The frameworkRoutes boot check now reads a listed route with a trailing or doubled slash as its path without the empty segment on every server, Spring no longer lets `*` allow a catch-all route or `/a/*` allow `/a/`, and on Laravel a policy's `denyAsNotFound()` answers the operation's not-found code instead of 403 when the operation declares one.
