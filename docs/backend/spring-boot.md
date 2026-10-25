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

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver;
- an operation has no handler;
- a route that is not in the contract is served and not allow-listed;
- another handler mapping, ordered before Spring MVC's, takes a contract route;
- the app does not run Spring MVC on Tomcat, or has no Jakarta Validation provider (add `spring-boot-starter-validation`);
- the contract writes absolute URLs and `seampact.<api>.public-origin` is missing or is not a scheme, host and port.

Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

## Behind a reverse proxy and in Docker

Set the forwarded-headers strategy, so Spring reads the proxy's headers:

```properties
server.forward-headers-strategy=framework
```

With `framework`, a prefix sent in `X-Forwarded-Prefix` is applied, and the contract's routes still match. The same holds for `server.servlet.context-path` and `spring.mvc.servlet.path`. Strip any forwarded header a client sends at your edge proxy: only the proxy may set them.

The public URL of the api stays the one in the contract. Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. If the contract writes absolute URLs, set the public origin; the request's `Host` is never read:

```properties
seampact.tasks.public-origin=https://api.example.com
```

Pass secrets as environment variables (`SPRING_` properties or `${...}` placeholders), never baked into the image.
