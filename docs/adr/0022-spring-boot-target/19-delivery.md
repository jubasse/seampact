### Delivery

| PR | Delivers |
|---|---|
| spring-1 | the generator in `jvm/seampact-spring-boot` (Kotlin, Palantir JavaPoet pinned): `SpringBootTarget.generate(ir, entry)`, the options, types, records with redacted `toString()`, interfaces, composed annotations, results and exceptions; `SpringBootOptionsTest` and `SpringBootGoldenTest`, whose golden is compiled by `javac` on 21 and 25 against Spring Boot 4, and whose redaction case checks the `toString()` of one golden record of each kind of "Redaction" |
| spring-2 | the filter, interceptor, argument resolver, reply handler, exception resolver, outgoing check, hook beans and boot check; the sample app; the suite CLI; the Gradle rows of the workflow, on the core-path operations |
| spring-3 | paging, idempotency replay, throttle, cache and ETag headers, concurrency, rule proofs, restricted input fields, signed routes, absolute URLs, the `pack:spring` profile, `GeneratedRedactionTest`, the boot check rules of mappings, mount and container, the ECMA-262 pattern search; the entries' filter dropped |
| spring-4 | the Spring Security beans and customizer, `nativeDocs`, `frameworkDocs: off` through both plugins, the `springSecurity` default read from the compile classpath, `SecurityRefusalsTest`; form, multipart, download and redirect bodies stay refused by name until a consumer needs them |
