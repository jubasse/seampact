# Install

Create the app and install seampact from npm. Other ecosystems come after, in [Install from a registry](#install-from-a-registry).

Create the folder and the `src` folder in it.

```sh
mkdir -p ~/src/notes-app/src
cd ~/src/notes-app
```

Create `package.json`.

```json
{
  "name": "notes-app",
  "private": true,
  "type": "module",
  "dependencies": {
    "@nestjs/common": "12.1.3",
    "@nestjs/core": "12.1.3",
    "@nestjs/platform-express": "12.1.3",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "24.19.1",
    "tsx": "4.23.15",
    "typescript": "6.0.3"
  }
}
```

Not on NestJS? Your handlers page lists the dependencies to use instead.

Install seampact.

```sh
npm install @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nestjs
```

pnpm and Yarn take the same names. Keep every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Start the project.

```sh
npx seampact init
```

`init` writes `seampact.config.yaml`, a small example contract in `contract/api.yaml`, the editor schemas in `contract/.seampact/schemas`, and `.seampact/` in `.gitignore`. You see `Created .gitignore.` among its lines. `npx seampact init --blank` writes the api header alone instead of the example.

Create `tsconfig.json`. NestJS decorators need `experimentalDecorators`.

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "experimentalDecorators": true
  },
  "include": ["src"]
}
```

## On Python

Python 3.12 or later, and a FastAPI or Django REST Framework app. The Python `seampact` command has `generate` and `check` only, and reads a pinned bundle of the contract. So you write the contract as in the next pages, and pack it with `npx seampact bundle` (see [Sharing a contract](../features/sharing-contracts.md)).

Install seampact with `pip` (see [PyPI](#pypi)), set `use: pypi:seampact-fastapi` or `use: pypi:seampact-drf` in `seampact.config.yaml`, then run `seampact generate`. The steps are in the guide of your framework: [FastAPI](../backend/fastapi.md#set-up) or [Django REST Framework](../backend/drf.md#set-up).

## Install from a registry

Every package is on its ecosystem's registry, at the same version. Pick yours.

### npm

```sh
npm install --save-dev @seampact/cli @seampact/codegen-ts
```

Add the generators you use: [the package map](../concepts/packages.md) lists them.

### Maven Central (Gradle and Maven)

Gradle, in `build.gradle.kts` and `settings.gradle.kts`:

```kotlin
plugins {
    id("io.github.jubasse.seampact") version "<version>"
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

Maven, in `pom.xml`:

```xml
<plugin>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-maven-plugin</artifactId>
  <version>${seampact.version}</version>
</plugin>
```

The runtime and the hooks are `io.github.jubasse:seampact-spring-runtime` and `io.github.jubasse:seampact-hooks`. The [Spring Boot guide](../backend/spring-boot.md) has the full build.

### Composer (Packagist)

```sh
composer require seampact/laravel seampact/hooks
composer require seampact/symfony
```

Take the first line for Laravel, the second for Symfony. The packages are read-only mirrors of this repository: report problems on GitHub, not on the mirror.

### PyPI

```sh
pip install "seampact-fastapi[generate]"
```

Use `seampact-drf` or `seampact-ninja` for Django REST Framework or Django Ninja. The compiler binary comes with `seampact-ir`.

### The compiler binary

No Node.js, Java or PHP needed for `compile`, `lint`, `diff`, `explain` and `bundle`. Download the file for your system from the [releases page](https://github.com/jubasse/seampact/releases), with `SHA256SUMS`.

```sh
sha256sum --check --ignore-missing SHA256SUMS
chmod +x seampact-linux-x64
```

The files are `seampact-linux-x64`, `seampact-linux-arm64`, `seampact-darwin-x64`, `seampact-darwin-arm64` and `seampact-win32-x64.exe`. The macOS files carry an ad hoc signature only: if macOS blocks the file, allow it in System Settings, Privacy and Security.

## From a checkout

To work on seampact itself, or to try an unreleased change, install from your checkout. Replace `~/src/seampact` with the path of your checkout.

```sh
cd ~/src/seampact && pnpm install --frozen-lockfile
node ~/src/seampact/scripts/consumers/install-into.ts ~/src/notes-app
cd ~/src/notes-app && pnpm install
```

You see `install-into: 32 packages and packs in .../vendor/seampact`, then pnpm installs them. For Python, build the wheels with `sh ~/src/seampact/scripts/consumers/python/build-wheels.sh ~/src/seampact/python/dist` and install them with `pip install --no-index --find-links ~/src/seampact/python/dist`.

Next: [write the contract](02-first-contract.md)
