---
---

Laravel and Symfony servers accept query lists of scalars or enums in the `repeat` form (`tag=a&tag=b`) and the `comma` form (`tag=a,b`), each item decoded and validated by its type, which they refused at generate time before.
