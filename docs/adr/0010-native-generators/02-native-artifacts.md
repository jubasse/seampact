### Native artifacts

JVM, groupId `io.github.jubasse`:

| Artifact | Language | Role (ADR 0009) | Content |
|---|---|---|---|
| `seampact-ir` | Kotlin | core | IR model, naming, app-config reader (the file or the plugin DSL, [A42](../../decisions.md#a42)), bundle reader and verifier, binary runner |
| `seampact-hooks` | Java | hooks | access hook interfaces and runtime types imported by generated Java, the three-state `Field<T>` (ADR 0003 section 5); no dependency; vendorable (ADR 0009) |
| `seampact-runner` | Kotlin | core | the run both plugins share, free of any build-tool API: the pinned binary, the app layout, the generate and check runs and their problems; the generated header names the runner's version, so both plugins write the same files |
| `seampact-spring-boot` | Kotlin | target | the spring-boot generator, shared by both plugins |
| `seampact-spring-runtime` | Java | helper | the Spring boundary runtime generated code imports (ADR 0025); same version as the generator; its package stays `io.github.jubasse.seampact.springboot.runtime`, an exception to `io.github.jubasse.seampact.<module>`, since no generator jar is on the app's classpath |
| `seampact-gradle-plugin` | Kotlin | target | plugin id `io.github.jubasse.seampact`; task `seampactGenerate`, wired before Java compilation, with the config, the bundle or source, the binary hash and the options declared as task inputs and the output directory as its output, so up-to-date checks and the build cache work; the `seampact { }` DSL takes the app-config keys |
| `seampact-maven-plugin` | Kotlin | target | goal `generate`, bound to `generate-sources`, adds the output as a source root; goal `check`, bound to `verify`, runs the pinned-bundle check and the generated drift; `<configuration>` takes the app-config keys, each typed by the app-config schema, and an element with no JSON form for its key (an attribute, a repeated key, an unresolved `${...}`) is refused (`config.maven.shape`); `generate` skips when the stamp in `target/seampact/` records the same inputs (the config, the `path` source trees read through their links, the binary pin, `SEAMPACT_ALLOW_LOCAL`, the Spring Boot version, the bundle origins, the plugin's jars by coordinates, and by content for a snapshot or `0.0.0`) and the same generated files; bundles and binaries are cached under `~/.m2/seampact/` |

Plugin and generator bytecode targets Java 21, the lowest version A13 supports. Both plugins call the same generator library, and a golden test checks they produce identical files. `seampact-hooks` is plain Java so a Spring application does not pull the Kotlin standard library at run time.

Configuration follows each build tool's habit (A42): the app-config keys are written in `seampact.config.yaml` or in the plugin's DSL, with the same schema, never both for one app. Output goes to the app's `outDir`; a JVM app usually sets it to the build directory (`build/generated/sources/seampact/main`, `target/generated-sources/seampact`), leaves it uncommitted and sets `checks.generated` to `disabled`, while a team that reviews generated diffs keeps the default `__generated__` and commits it (ADR 0011).

Composer, vendor `seampact`:

| Package | Role | Content |
|---|---|---|
| `seampact/ir` | core | IR model, naming, app-config reader, bundle reader and verifier, binary runner, and the `vendor/bin/seampact` runner |
| `seampact/hooks` | hooks | access hook interfaces and runtime types imported by generated PHP, the three-state `Field`; no dependency; vendorable (ADR 0009) |
| `seampact/laravel` | target | a routes file or macro, controller interfaces, a FormRequest and middleware per operation (ADR 0012), the full server boundary around the developer's controller; an `artisan seampact:generate` command beside `vendor/bin/seampact` |
| `seampact/symfony` | target | a route loader, controller interfaces, the operation attribute and its `kernel.controller` listener, the input value resolver, Validator constraints, the full server boundary around the developer's controller |
| `seampact/api-platform` | target | resource metadata, DTOs, State Provider and Processor interfaces, the `kernel.controller` listener and the decorated deserialize provider; API Platform's own OpenAPI generation left as the app has it, completed with `nativeDocs` or turned off with `frameworkDocs: off` ([A43](../../decisions.md#a43)) |
| `seampact/laravel-spatie` | adapter | spatie/laravel-permission behind the decide hook ([A24](../../decisions.md#a24)) |

Targets are development requirements (`require-dev`), except the server targets `seampact/laravel` and `seampact/symfony`, production packages since their runtime is imported by the generated code (ADR 0025); `seampact/hooks` is a runtime requirement of the application. The `vendor/bin/seampact` runner discovers installed targets through a key in each target's `composer.json` `extra` section, the PHP counterpart of the Node CLI resolving targets from the project (ADR 0009). The PHP floor is 8.3, patched: every seampact Composer package requires `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`, the releases that fix PHP2Shell (CVE-2026-109618 and CVE-2026-109619), so Composer refuses to install them on an unpatched PHP. Composer's runtime platform check tests only the lowest bound, so the runner also refuses to run on an unpatched PHP (`php.unpatched`, naming the running version and the fixed release of its branch). A distribution build that backports the fixes under an older version number (Debian, Ubuntu) passes with `extra.seampact.phpPatched: true` in the root `composer.json`, beside Composer's own `config.platform` for the install. The check runs when seampact generates or checks code; Composer's install check covers a deploy, and nothing is checked while the app serves requests. CI runs the latest 8.3 and 8.5.
