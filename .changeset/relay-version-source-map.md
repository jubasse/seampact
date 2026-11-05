---
"@seampact/compiler": patch
---

A service route relaying a write with a version check now compiles instead of crashing when the source map is built, and a relayed schema keeps its examples, defaults and extension values unchanged when they hold an `origin` member.
