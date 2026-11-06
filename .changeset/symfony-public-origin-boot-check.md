---
---

On Symfony, the boot check now reads the bundle's `public_origin`, so an api under absolute URLs with a valid origin starts, and a `public_origin` set under relative URLs is refused at `cache:warmup`.
