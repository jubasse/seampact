---
---

Laravel, Symfony, FastAPI, Django REST framework and Django Ninja now answer a request sending both cursors of an `after` and `before` paging pair with the 400 `exclusiveCursors` issue instead of passing it to the handler, and their refusal of a page fact they do not generate, such as `complete`, now says the 1.0 targets do not serve it.
