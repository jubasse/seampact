# Install in other ecosystems

Every package is on its ecosystem's registry, at the same version. Pick yours. For a Node.js server, see [Install](01-install.md). To type the commands on each stack, see [commands per stack](../features/commands-per-stack.md).

## npm

```sh
npm install --save-dev @seampact/cli @seampact/codegen-ts
```

Add the generators you use: [the package map](../concepts/packages.md) lists them.

## Maven Central (Gradle and Maven)

Gradle, in `build.gradle.kts` and `settings.gradle.kts`:

```kotlin
plugins {
    id("io.github.jubasse.seampact") version "1.1.0"
}
```

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
```

The Gradle Plugin Portal is still reviewing the plugin. Until it approves, Gradle loads the plugin from Maven Central, which `mavenCentral()` above already adds.

Maven, in `pom.xml`:

```xml
<plugin>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-maven-plugin</artifactId>
  <version>1.1.0</version>
</plugin>
```

The runtime and the hooks are `io.github.jubasse:seampact-spring-runtime` and `io.github.jubasse:seampact-hooks`. The [Spring Boot guide](../backend/spring-boot.md) has the full build.

## Composer (Packagist)

For Laravel:

```sh
composer require seampact/laravel seampact/hooks
```

For Symfony:

```sh
composer require seampact/symfony
```

For API Platform 5 (on Symfony):

```sh
composer require seampact/api-platform api-platform/symfony
```

The packages are read-only mirrors of this repository: report problems on GitHub, not on the mirror. Follow the [Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md) or [API Platform](../backend/api-platform.md) guide.

## PyPI

Python 3.12 or later, and a FastAPI, Django REST Framework or Django Ninja app.

```sh
pip install "seampact-fastapi[generate]"
```

Use `seampact-drf` or `seampact-ninja` for Django REST Framework or Django Ninja. Set `use: pypi:seampact-fastapi` (or `pypi:seampact-drf`, `pypi:seampact-ninja`) in `seampact.config.yaml`, then run `seampact generate`. The steps are in the guide of your framework: [FastAPI](../backend/fastapi.md#set-up), [Django REST Framework](../backend/drf.md#set-up) or [Django Ninja](../backend/ninja.md#set-up).

The Python `seampact` command has `generate` and `check` only. It reads the contract as a [bundle](../concepts/glossary.md): a packed, versioned copy. Make it with `seampact bundle`, from the npm CLI or the compiler binary (see [Sharing a contract](../features/sharing-contracts.md)). A `path` source or the OpenAPI documents need the compiler: install `seampact-ir[compiler]`.

## The compiler binary

The binary needs no Node.js, Java or PHP for `compile`, `lint`, `diff`, `explain` and `bundle`. Download the file for your system from the [releases page](https://github.com/jubasse/seampact/releases), with `SHA256SUMS`.

```sh
sha256sum --check --ignore-missing SHA256SUMS
chmod +x seampact-linux-x64
```

The files are `seampact-linux-x64`, `seampact-linux-arm64`, `seampact-darwin-x64`, `seampact-darwin-arm64` and `seampact-win32-x64.exe`. The macOS files carry an ad hoc signature only: if macOS blocks the file, allow it in System Settings, Privacy and Security.

## From a checkout

To work on seampact itself, or to try an unreleased change, install from your checkout. Replace `~/src/seampact` with the path of your checkout and `~/src/notes-app` with your app.

```sh
cd ~/src/seampact && pnpm install --frozen-lockfile
node ~/src/seampact/scripts/consumers/install-into.ts ~/src/notes-app
cd ~/src/notes-app && pnpm install
```

You see `install-into: 32 packages and packs in .../vendor/seampact`, then pnpm installs them. Add `vendor` to the app's `.gitignore`. For Python, build the wheels and install them:

```sh
sh ~/src/seampact/scripts/consumers/python/build-wheels.sh ~/src/seampact/python/dist
pip install --no-index --find-links ~/src/seampact/python/dist
```

Next: the guide of your framework, [Spring Boot](../backend/spring-boot.md), [Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md), [API Platform](../backend/api-platform.md), [FastAPI](../backend/fastapi.md), [Django REST Framework](../backend/drf.md) or [Django Ninja](../backend/ninja.md).
