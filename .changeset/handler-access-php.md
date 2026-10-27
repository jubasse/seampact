---
---

On Laravel and Symfony, a handler now reads who is calling: the FormRequest's `principal()` and `scopes()` on Laravel, the input's `principal` and `scopes` on Symfony, with the principal in its generated class and each scope as its resolver returned it.
