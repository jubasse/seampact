---
"@seampact/compiler": patch
---

Report a relay route that does not answer a code of its public operation, and refuse patterns such as `^((a|aa)b?)*$` that backtrack exponentially through a repeated alternation.
