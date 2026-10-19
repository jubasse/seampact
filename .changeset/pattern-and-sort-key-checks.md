---
"@seampact/compiler": patch
---

The compiler refuses a `pattern` that can backtrack exponentially (a repeated group holding a repetition, or a repeated alternation whose branches start alike) and a sort key holding `,` or starting with `-` under the signed sort style.
