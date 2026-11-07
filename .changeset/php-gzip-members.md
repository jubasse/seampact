---
---

The PHP boundary now reads a gzip request body of several members whole, and refuses as invalid the bytes after a gzip or deflate stream that do not start another gzip member.
