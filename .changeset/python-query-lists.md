---
---

FastAPI, Django REST Framework and Django Ninja servers accept a query list of scalars or enums in the `repeat` form (`state=open&state=done`) and the `comma` form (`score=1,20`), each item checked like a single parameter, which they refused at generate time before.
