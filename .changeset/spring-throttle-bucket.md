---
"@seampact/server-runtime": patch
---

Spring now gives the decide hook of a throttle rule the bucket's key values, limit and window, which it sent empty before.
