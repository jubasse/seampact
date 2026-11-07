---
---

The PHP boundary now refuses a gzip or deflate request body cut before its end as invalid, instead of reading it as a shorter body.
