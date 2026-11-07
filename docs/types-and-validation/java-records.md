# Java records

The Spring Boot plugin writes a Java record for each schema of your contract, with the Bean Validation annotations whose meaning matches the contract. A generated structural validator checks the rest.

Used by: [Spring Boot](../backend/spring-boot.md).

## Set up

Nothing to add: the Gradle or Maven plugin writes the records under the `schemas` package of your `package` option. Spring Boot has no `rules` option.

## What you get

For the `CreateTask` schema of the [overview](README.md):

<!-- excerpt: jvm/seampact-spring-boot/src/test/golden/com/example/tasks/api/schemas/CreateTask.java -->
```java
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record CreateTask(@NotNull String title, Optional<@Min(0) Long> effort) {
```

The record carries these checks as Bean Validation annotations:

- `@NotNull` on a required member, and `@Valid` on a member that is a record.
- `@Min`, `@Max`, `@DecimalMin` and `@DecimalMax` for number bounds. Above, `effort` is `@Min(0)`.
- `@Size` on a list, for its item count.

An optional member is an `Optional`. A `uuid` is a `UUID` and a `date-time` is an `OffsetDateTime`. An enum constant keeps its wire value with `@JsonProperty`.

## Where the request is checked

The request is not checked by these annotations. A generated structural validator in the Spring runtime checks the whole request before your controller runs: types, required members, unknown keys, number bounds, item counts and the string checks below. The annotations are for your own code: validate a record you build with `@Valid` and a Jakarta Validation provider, and the same bounds apply.

The record has no `@Size` on `title`, yet `title` must still have 1 to 200 characters. A string length is not an annotation, because Bean Validation counts a string in a way that differs from the contract. The structural validator checks:

- the length of a string, counted in code points as the contract counts it;
- a `pattern`, a `format` and `multipleOf`.

## When a check fails

The structural validator reports every issue with its JSON pointer and its contract rule, and the server answers the [400 body](README.md#when-a-check-fails).

## Native or consistent rules

There is no choice: the checks are always the contract's. Spring Boot has no `rules` option.

## Limits

The Spring Boot generator refuses by name a `oneOf`, a map schema and a file value ([Generate fails](../troubleshooting/generate.md#spring-boot)).

## Next

- [Spring Boot](../backend/spring-boot.md).
- The 400 body: [When a check fails](README.md#when-a-check-fails).
