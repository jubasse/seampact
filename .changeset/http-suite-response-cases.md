---
"@seampact/http-suite": minor
---

Add cases for several 2xx statuses on one route, every Cache-Control directive, the no-store of a sensitive field and its absence from the app's log lines, deprecation headers, If-Match preconditions and the default code of each derived error, with a step's `logLines` expectation over the lines the app logged while it ran and a case's `apis` list that a pack profile refuses when its app does not serve them.
