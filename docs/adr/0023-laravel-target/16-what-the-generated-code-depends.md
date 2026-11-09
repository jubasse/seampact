### What the generated code depends on

At run time:

- PHP `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`, the releases carrying the October 2026 fixes (CVE-2026-109618 and CVE-2026-109619), so Composer refuses an unpatched runtime; ext-json, ext-mbstring and ext-zlib;
- `laravel/framework` 13 (routing, validation, the HTTP kernel, the container), and Symfony VarDumper, which it brings, for the caster;
- `seampact/hooks`, and `seampact/laravel` with `seampact/codegen`, whose runtime the code imports.

The boundary runtime is imported, not copied (ADR 0025): its framework-neutral part (the contract view, step 1's decoding, steps 2 to 5, field rights, the typed input, the replies and the outgoing verdict) comes from `seampact/codegen`, shared with the Symfony target, which finds the app's hooks through a hook-lookup interface that `Laravel\Runtime\Hooks` answers from the container; the Laravel part (the middleware, the provider, the FormRequest rules, the exception map and the boot check) comes from `seampact/laravel`, under `Seampact\Laravel\Runtime`, and the shared part under `Seampact\Codegen\Runtime`. Generated code imports no other seampact package than these and `seampact/hooks`, no validation or serializer library, and no Laravel package beyond the framework (Sanctum, Octane and spatie stay the app's). `seampact/laravel` is a production `require`, so the generator and its dependencies sit in production `vendor/`; its artisan command is registered by Laravel's package discovery. Generated files print through `nette/php-generator`'s `PsrPrinter` (ADR 0015) and pass `php -l` and PHPStan at level max on 8.3 and 8.5.
