---
"@seampact/codegen-core": patch
---

The Node servers now refuse at generation a file download or a redirect response by name instead of generating it, and every server refuses a query list in brackets form (`tag[]=a`) by name as `query.list.brackets.unsupported`; Spring Boot, Laravel, Symfony, FastAPI, Django REST framework and Django Ninja used to read it as an undeclared key.
