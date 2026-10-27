---
---

The Symfony bundle now builds under the skeleton's `services.yaml` with no `exclude` line, refuses a mistyped `seampact_<api>` value or a missing `symfony/validator` at `cache:clear` naming the fix, and registers its services under `seampact.<api>.<role>` ids.
