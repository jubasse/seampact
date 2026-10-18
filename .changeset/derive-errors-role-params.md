---
"@seampact/compiler": minor
---

Role binding `params` are now checked as templates whose rendered params must provably fit the bound code's params schema, enums, formats and refinements included (a nested `$each`, a slot path naming no member and a merged member the param lacks are refused), a redeclared default code keeps its status and nature, and a code listed by an identity, right, rule or scope must be declared.
