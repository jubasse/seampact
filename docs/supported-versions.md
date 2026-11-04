# Supported versions

Which framework and runtime versions seampact supports, and when it stops.

## The versions it supports

seampact supports the versions their maintainers still maintain. For example:

- Django 5.2 LTS and 6;
- Symfony 7.4 and 8;
- Python 3.12 and later;
- Spring Boot 4.

The [supported stacks](../README.md#supported-stacks) table lists every framework and its versions.

## Dependencies of the framework

Inside a supported version, seampact accepts the range the framework accepts. It does not raise its floor each time an advisory is published for one of those dependencies: keeping them current is your app's job.

For example, seampact accepts every Starlette that FastAPI accepts. The [FastAPI guide](backend/fastapi.md#starlette) says why.

## A version its maintainers no longer maintain

It stays supported as long as it costs nothing:

- it keeps working, with the same generated code;
- the day it needs work (a test that breaks, a fix of its own), seampact drops it, in a minor release too.

Move to a maintained version when you can. AdonisJS 6 is in this case today: see the [AdonisJS guide](backend/adonisjs.md#what-changes-for-adonisjs-6).

## The exception: PHP

The PHP engine runs seampact's own runtime, so seampact requires the PHP patch releases that fix security flaws in the engine itself: `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`. Composer refuses to install seampact on an older patch release.
