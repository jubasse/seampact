---
---

The Laravel target now generates each operation's FormRequest in the api's root namespace, beside its input, result and errors, so a controller imports it from `App\Generated\<Api>` instead of `App\Generated\<Api>\Laravel`.
