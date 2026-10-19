---
"@seampact/compiler": patch
---

The compiler refuses two `pattern` shapes that backtrack exponentially (a repeated group whose tail repetition can match what the group starts with, as `(a+)+`, and a repeated alternation whose branches start alike, as `(a|ab)*`) and a sort key holding `,` or starting with `-` under the signed sort style.
