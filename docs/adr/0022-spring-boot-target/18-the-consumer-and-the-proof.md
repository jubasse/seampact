### The consumer and the proof

The sample app lives in `scripts/consumers/targets/spring-boot/`. It holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a Logback appender. It reads the template's credentials from the shared JSON. A Gradle and a Maven build root each copy it to `$RUNNER_TEMP`; the Gradle root takes the plugin and `seampact-hooks` from the repository's `jvm/` build, included by path, and the compiler binary the workflow built. The `allow-listed-framework-route` boot variant runs on a second jar, built from a config that allow-lists its route.

The workflow `p6-spring-boot.yml` has five jobs:

- `changes`;
- `compiler-binary` (Node), which builds the linux-x64 binary;
- `build`, a matrix whose first step fails when `node`, `npm` or `npx` is found. It builds the app with each plugin on JDK 21 and 25 from the reference contract's bundle, served over https by `java Serve.java`, and on JDK 25 from the local `path` source ("Every operation" below);
- `http-suite`, which starts `java -jar` and runs the `default`, `hand-written` and `boot` profiles, plus `pack:spring` on a third jar built with `@seampact/pack-spring`, through the suite's CLI (ADR 0015 "Suite profiles"), with the boot profile run as `command: java`;
- `spring-boot`, the aggregate, failing on any failed or cancelled job.

The proof is:

- the `node`-absent step;
- a green suite row per build tool and JDK;
- the consumer's JUnit `GeneratedRedactionTest` (one record of each kind of "Redaction" holding a known secret, which must be absent while `[redacted]` is present) and `SecurityRefusalsTest` (Spring Security's 401, 403 and CSRF refusal in the api's format, and a public route the customizer lets through a chain that requires authentication; the reference contract declares no optional-auth operation and no public template beside a literal route, so the generator's golden checks run the matchers in a Spring Security chain on routes of every access kind, and springdoc on the `nativeDocs` and `frameworkDocs: off` output);
- the plugins lane's `identical-files` diff of both plugins' output.

Suite cases that wait for a later PR carry a refusal naming that PR; the list is empty at spring-4.

**Every operation.** From spring-3 the app config's spring-boot entries serve every operation of the reference contract, with no `operations` filter. No other fixture is added.
