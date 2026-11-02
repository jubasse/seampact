---
---

Django Ninja apps now serve their contract end to end: `bind_<api>()` adds the api's Router to the app's NinjaAPI, with sync or async views, the shared boundary and boot check, Ninja's `auth=` and throttles per access kind, the contract routes in Ninja's own OpenAPI document with `nativeDocs`, and every Python target refuses an entry whose target has no compatibility-matrix row.
