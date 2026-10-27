# Write the handlers (Spring Boot)

The Gradle plugin generates the contract's Java code when you build. You write the controllers and the hooks; the generated boundary checks each request and each reply.

## Set up the build

```kotlin
plugins {
    java
    id("org.springframework.boot") version "4.1.1"
    id("io.github.jubasse.seampact")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("io.github.jubasse:seampact-hooks")
}
```

In `seampact.config.yaml`, add one entry per api:

```yaml
targets:
  - id: notes
    use: io.github.jubasse:seampact-spring-boot
    api: notes
    options: { package: com.example.notes.api }
```

`./gradlew build` generates the code, then compiles it with yours. The Node CLI does not generate a Spring Boot entry: `seampact generate` refuses it with `config.target.native`.

### With Maven

Add the plugin to `pom.xml`, next to `seampact-hooks`:

```xml
<plugin>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-maven-plugin</artifactId>
  <version>${seampact.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>generate</goal>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

`./mvnw verify` generates the code before it compiles, then checks it. When nothing changed since the last run, `generate` skips.

You can write the config in `<configuration>` instead of `seampact.config.yaml`, with the same keys. A list holds one child per item:

```xml
<configuration>
  <outDir>target/generated-sources/seampact</outDir>
  <targets>
    <target>
      <id>notes</id>
      <use>io.github.jubasse:seampact-spring-boot</use>
      <api>notes</api>
      <options><package>com.example.notes.api</package></options>
    </target>
  </targets>
</configuration>
```

Keep one of the two: a project with both fails.

### Spring Boot versions

The plugins read the Spring Boot version of your build. Spring Boot 4 is tested. Spring Boot 3 fails with `config.matrix.incompatible`. A newer major prints `config.matrix.untested`; accept it on the entry with `allowUntested: [spring-boot@5]`, or make it fail with `checks: { matrix: error }`.

### When the build fails

Each error starts with a code, such as `framework.version.unresolved` or `binary.compile-failed`. Find it in [Troubleshooting](../troubleshooting/README.md).

## Write a controller

Each resource has a generated `<Resource>Endpoints` interface, and each operation a mapping annotation in `<package>.spring`. Return one arm of the operation's result: `Status200` and the like, or an error of `<Operation>Errors`.

```java
@RestController
class NotesController implements NotesEndpoints {
    @Override
    @GetNote
    public GetNoteResult getNote(GetNoteInput input) {
        Note note = notes.get(input.path().noteId());

        return note == null
                ? new GetNoteErrors.ApiNotFound()
                : new GetNoteResult.Status200(note);
    }
}
```

The boundary has already checked the path, query, headers and body. You never write a status or a content type yourself.

When an operation takes a version, the boundary checks its format only. Compare it with the stored version yourself, and return the operation's conflict error when they differ:

```java
if (input.body().expectedVersion() != task.version()) return new UpdateTaskErrors.StateConflict();
```

With `@seampact/pack-spring`, a list in the `springPage` style gets a `Pageable` in its input and returns Spring Data's `Page`. Add `org.springframework.data:spring-data-commons`; the Spring Boot BOM gives its version.

- A sort key reaches the `Pageable` as the item's Java member name: `sort=created_at,desc` sorts by `createdAt`. Name your entity's properties like the generated record's members.
- A page number past Spring Data's range (a page index above 2147483647) gets a 400 at the page parameter.

## Register the hooks

Hooks are beans. Write one per identity, one decider for your rights and rules, and one resolver per scope.

```java
@Component
class UserHook implements UserAuthenticateHook {
    @Override
    public AuthenticateResult<UserPrincipal, Denial> authenticate(UserAuthenticateRequest request) {
        return request.credentials().bearer()
                .flatMap(tokens::userOf)
                .<AuthenticateResult<UserPrincipal, Denial>>map(AuthenticateResult.Authenticated::new)
                .orElseGet(() -> new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated")));
    }
}
```

A decider lists the names it answers in `names()`, or `Decider.EVERY_NAME` for all of them.

## With Spring Security

With Spring Security on the classpath (`spring-boot-starter-security`), the plugin generates, for the `notes` api:

- `NotesSecurityMatchers`: the contract's routes by access kind (`publicRoutes()`, `optionalRoutes()`, `identityRoutes()`, `signedRoutes()`, `anonymousOnRefusalRoutes()`);
- `SecurityRefusals`: an entry point and an access-denied handler that answer 401, 403 and a CSRF refusal in the api's error format.

Set `springSecurity: false` in the entry's options to turn them off. Setting it on without Spring Security on the classpath fails the build with `options.springSecurity.unavailable`.

Wire them in your chain:

```java
@Bean
SecurityFilterChain chain(HttpSecurity http, NotesSecurityMatchers routes, SecurityRefusals refusals) {
    return http
            .authorizeHttpRequests(authorize -> authorize
                    .requestMatchers(routes.publicRoutes(), routes.optionalRoutes(), routes.signedRoutes()).permitAll()
                    .requestMatchers(routes.identityRoutes()).hasRole("MEMBER")
                    .anyRequest().authenticated())
            .exceptionHandling(handling -> handling.authenticationEntryPoint(refusals).accessDeniedHandler(refusals))
            .build();
}
```

Each matcher follows the route the api serves, so a public `/notes/{id}` never covers a protected `/notes/mine`. Signed routes are permitted: the api checks their signature.

With `springSecurity: { matchers: true }`, a generated `Customizer<HttpSecurity>` permits the public, optional-auth and signed routes for you, in every chain. It runs before your own rules and your own customizers. A chain with no authorization rules of its own then denies every request it does not permit, so give each chain its rules. The customizer needs `spring-security-config`, which `spring-boot-starter-security` brings; without it, the build fails with `options.springSecurity.matchers.unavailable`.

Your authenticate hook reads the user from `SecurityContextHolder`. On an optional-auth route that calls anonymously when the token is refused, keep the route out of your bearer filter:

```java
@Bean
BearerTokenResolver bearerTokens(NotesSecurityMatchers routes) {
    DefaultBearerTokenResolver standard = new DefaultBearerTokenResolver();
    return request -> routes.anonymousOnRefusalRoutes().matches(request) ? null : standard.resolve(request);
}
```

## springdoc

- `artefacts: { nativeDocs: true }` puts springdoc's `@Operation` on the generated interfaces. Each success shows the body the contract declares, not the handler's result type. Add `io.swagger.core.v3:swagger-annotations-jakarta` (springdoc brings it).
- `frameworkDocs: off` writes `seampact-notes.properties`, which turns springdoc's document off. Load it in `application.properties`:

```properties
spring.config.import=classpath:seampact-notes.properties
```

The boot check fails when springdoc still serves its document.

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver;
- an operation has no handler;
- a route that is not in the contract is served and not allow-listed;
- another handler mapping, ordered before Spring MVC's, takes a contract route;
- the app does not run Spring MVC on Tomcat;
- the contract writes absolute URLs and `seampact.<api>.public-origin` is missing or is not a scheme, host and port.

By default the check reads only routes that reach a path of the api; `artefacts.bootCheck.frameworkRoutes: strict` checks them all. Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

## Replies that break the contract

By default a reply that breaks the contract becomes the api's 500. With `seampact.<api>.responses: warn` it goes out as written and the violation is logged, a body that fails `bodyValidation` included. A result that breaks its own type (a null, a page without items or with a negative total) is still a 500.

## Format envelopes and null

- The success body goes out in its format's envelope. With `pack:laravel` your `Note` leaves as `{ "data": { ... } }`; with a bare format it leaves as it is. You still return the plain value.
- A `null` body answers the format's null (`null`, or the envelope with a null payload). The boundary refuses it unless the schema is nullable. A `null` list, table or page is always refused.
- An opaque value takes `null` only when it is `nullable`.
- A number past the range of a double inside an opaque value is a `type` issue (400).
- A format with meta members, success headers or envelope slots the boundary cannot write is refused at generate time: see [Generate errors](../troubleshooting/generate.md).

## Behind a reverse proxy and in Docker

Set the forwarded-headers strategy, so Spring reads the proxy's headers:

```properties
server.forward-headers-strategy=framework
```

With `framework`, a prefix sent in `X-Forwarded-Prefix` is applied, and the contract's routes still match. The same holds for `server.servlet.context-path` and `spring.mvc.servlet.path`. To serve the api under a prefix inside the app, set `mount: /api` on the target entry. Strip any forwarded header a client sends at your edge proxy: only the proxy may set them.

The public URL of the api stays the one in the contract. Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. If the contract writes absolute URLs, set the public origin; the request's `Host` is never read:

```properties
seampact.tasks.public-origin=https://api.example.com
```

Pass secrets as environment variables (`SPRING_` properties or `${...}` placeholders), never baked into the image.
