<!-- Generated from docs/features/commands-per-stack.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Commands per stack

Page: https://jubasse.github.io/seampact/features/commands-per-stack/

Every page of this guide writes `seampact <command>`. This page gives the line to type for your stack. Run it in the app folder.

| Command | Node (npm) | Gradle | Maven | PHP | Python | Compiler binary |
|---|---|---|---|---|---|---|
| `init` | `npx seampact init` | not available | not available | not available | not available | not available |
| `generate` | `npx seampact generate` | `./gradlew seampactGenerate` (`./gradlew build` runs it) | `./mvnw generate-sources` (`verify` runs it) | `vendor/bin/seampact generate` | `seampact generate` | not available |
| `check` | `npx seampact check` | `./gradlew seampactCheck` (`./gradlew check` runs it) | `./mvnw verify` | `vendor/bin/seampact check` | `seampact check` | not available |
| `lint` | `npx seampact lint` | use the binary | use the binary | use the binary | use the binary | `seampact lint` |
| `diff` | `npx seampact diff --against <baseline>` | use the binary | use the binary | use the binary | use the binary | `seampact diff --against <baseline>` |
| `bundle` | `npx seampact bundle` | use the binary | use the binary | use the binary | use the binary | `seampact bundle` |

- Without Node, the [compiler binary](https://jubasse.github.io/seampact/getting-started/install-other-ecosystems/#the-compiler-binary) runs `compile`, `lint`, `diff`, `explain` and `bundle`. It has no `init`, `generate` or `check`.
- `init` writes the config and an example contract. On the other stacks, write `seampact.config.yaml` by hand: [the config file](https://jubasse.github.io/seampact/configuration/config-file/) shows how.
- Laravel also runs `php artisan seampact:generate`. Symfony runs `bin/console seampact:generate` after you list its commands bundle. API Platform runs `vendor/bin/seampact generate` and the Symfony commands. Django runs `python manage.py seampact_generate` and `python manage.py seampact_check`.
- On Maven, the plugin runs `generate` before the compile and `check` in `verify`. On Gradle, `./gradlew check` also runs `seampactCheck`.
- The Python `seampact` command has `generate` and `check` only. It reads a [bundle](https://jubasse.github.io/seampact/concepts/glossary/), which you make with `bundle`.

Where each stack writes the generated files: [Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files). To run `check` in CI: [Check in CI](https://jubasse.github.io/seampact/features/check-in-ci/).
