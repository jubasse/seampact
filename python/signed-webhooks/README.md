# seampact-signed-webhooks

Verifies a signed webhook (HMAC, timestamp tolerance, secret rotation) inside a seampact authenticate hook on Python.

```sh
pip install seampact-signed-webhooks
```

Guide: https://jubasse.github.io/seampact/concepts/packages/

The template signature verifier an authenticate hook calls for a signed identity (ADR 0013), for Python apps.
