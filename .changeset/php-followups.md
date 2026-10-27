---
---

On Laravel and Symfony, a framework throttle refusal now answers the rate-limited code with its delay read from `Retry-After` (else a logged 500 instead of a body missing its required params), and a contract path whose static segment a client would percent-encode is refused at generation.
