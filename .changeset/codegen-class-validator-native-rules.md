---
"@seampact/codegen-class-validator": minor
---

Generated DTOs now use class-validator's own `@MinLength`, `@MaxLength`, `@IsUUID`, `@IsRFC3339`, `@Min`, `@Max` and `@IsDivisibleBy`; set `rules: seampact-consistent` to keep the contract's exact checks.
