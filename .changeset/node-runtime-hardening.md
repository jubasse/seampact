---
"@seampact/codegen-core": patch
---

The Node server boundary now refuses a principal off its schema (500), a scope id, subject id, bucket key or body proof off its schema before the hook sees it (400), a repeated query key and an undeclared sort key (400), and replays an idempotent request sent on an equivalently encoded path.
