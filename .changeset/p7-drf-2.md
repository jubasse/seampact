---
---

A DRF app now serves its contract: the generated boundary middleware checks each contract request and reply, the generated views run authentication, scopes, requirements and serializer validation, and `manage.py seampact_check` and the Django system check report every setup problem by name, warning of a Django or DRF minor outside the tested ones.
