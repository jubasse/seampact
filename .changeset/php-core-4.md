---
---

`vendor/bin/seampact` now writes and checks seampact's OpenAPI documents through the pinned compiler binary and checks each PHP target's framework version against the compatibility matrix.
The fix of an OpenAPI document edited by hand now names `seampact generate --force`, which writes it again.
