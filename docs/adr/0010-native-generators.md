# ADR 0010: Native generators and the standalone compiler

Status: accepted. Amended for 2.0.0 by [ADR 0031](0031-rust-core.md): the native IR readers and generators go (sections 01, 02, 04), the standalone binary carries the generators (05), and the JVM, PHP and Python channels become launchers (08, 09, 10).

## Context

Generators outside the TypeScript ecosystem are native to their ecosystem and read the IR (amendment [A7](../decisions.md#a7)). Java users install a Gradle or Maven plugin; PHP users install Composer packages ([A15](../decisions.md#a15)). The consumer never needs Node.js: a native plugin gets the IR from a contract bundle, or, for a local YAML source, from a standalone compiler binary pinned by hash ([A9](../decisions.md#a9)). Generated Java compiles and is tested on Java 21 and 25 ([A13](../decisions.md#a13)). PHP packages live in the monorepo and reach Composer through read-only mirrors ([A19](../decisions.md#a19)). The binary ships for five platforms ([A26](../decisions.md#a26)), and the namespaces are fixed ([A27](../decisions.md#a27)).

Two risks shape this ADR: Node single executable applications (SEA) are still experimental and need per-platform signing, and Composer cannot install from a monorepo subdirectory.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| Native generators read generated IR models | [0010-native-generators/01-native-generators-read-generated-ir.md](0010-native-generators/01-native-generators-read-generated-ir.md) |
| Native artifacts | [0010-native-generators/02-native-artifacts.md](0010-native-generators/02-native-artifacts.md) |
| Namespaces | [0010-native-generators/03-namespaces.md](0010-native-generators/03-namespaces.md) |
| How a native plugin gets the IR | [0010-native-generators/04-how-a-native-plugin-gets.md](0010-native-generators/04-how-a-native-plugin-gets.md) |
| The standalone compiler binary | [0010-native-generators/05-the-standalone-compiler-binary.md](0010-native-generators/05-the-standalone-compiler-binary.md) |
| PHP mirror repositories | [0010-native-generators/06-php-mirror-repositories.md](0010-native-generators/06-php-mirror-repositories.md) |
| API Platform spike | [0010-native-generators/07-api-platform-spike.md](0010-native-generators/07-api-platform-spike.md) |
| The JVM channels | [0010-native-generators/08-the-jvm-channels.md](0010-native-generators/08-the-jvm-channels.md) |
| The PHP channels | [0010-native-generators/09-the-php-channels.md](0010-native-generators/09-the-php-channels.md) |
| The Python channels | [0010-native-generators/10-the-python-channels.md](0010-native-generators/10-the-python-channels.md) |

## Consequences

- A Java, PHP or Python consumer works with no Node.js installed, from a bundle (no compiler at all) or from a local source (the pinned binary).
- Every IR change touches two generated models in the same PR; CI makes forgetting it impossible.
- Each binary release implies a plugin release that embeds its hashes. Consumers can override them without waiting.
- Linux musl (Alpine) is not a shipped binary platform; a consumer on Alpine uses the bundle path or a glibc build image.
- Every Composer package needs a mirror at publication: the six above plus the signed-webhook helper of ADR 0013, not only the three targets A19 names.

## Traceability

- History: the dated amendments this ADR carried until PR #451 are folded into the sections they changed; `git show 43055be4:docs/adr/0010-native-generators.md` holds them with their dates.
- FRs: FR-40, FR-38, FR-37 (version checks), FR-14 (native targets), FR-17 (standalone binary and mirrors), FR-19 (Gradle and Maven plugins), FR-21 (PHP targets), FR-13 (`diff` in the binary); amendments A7, A9, A13, A15, A19, A26, A27, A28, [A41](../decisions.md#a41), A42, A43, [A48](../decisions.md#a48).
- Checklist items enabled: CHK-072 (unpublished installs from Maven local and Composer path repositories), CHK-076 (no Node.js on native consumers), CHK-077 and CHK-078 (version checks and open enums in the native models), CHK-079 (Java 21 and 25 through Gradle and Maven), CHK-083, CHK-084 and CHK-085 (PHP targets), CHK-088 (mirror trees installable), CHK-140 (binary commands), CHK-158 (`Field`), CHK-159 (PHP decoding), CHK-166 (JVM DSL, build-directory output, artisan), CHK-167 (JSON-LD contexts).
