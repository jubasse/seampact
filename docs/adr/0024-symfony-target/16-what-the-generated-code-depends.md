### What the generated code depends on

At run time:

- PHP `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`, the releases carrying the October 2026 fixes (CVE-2026-109618 and CVE-2026-109619), so Composer refuses an unpatched runtime; ext-json, ext-mbstring and ext-zlib;
- `symfony/framework-bundle`, `symfony/http-kernel`, `symfony/routing`, `symfony/validator` and `symfony/var-dumper`, 7.4 or 8.x, the versions the app already has;
- `seampact/hooks`, and `seampact/symfony` with `seampact/codegen`, whose runtime the code imports.

The boundary runtime is imported, not copied (ADR 0025): `Seampact\Symfony\Runtime`, which `seampact/symfony` autoloads from `runtime/`, and the shared `Seampact\Codegen\Runtime`. Generated code imports no other seampact package than these and `seampact/hooks`, no Serializer, and no package beyond Symfony's own components (SecurityBundle, RateLimiter and NelmioCors stay the app's). `seampact/symfony` is a production `require`; its `seampact:generate` command comes with its own bundle, which the app still lists in `config/bundles.php` for the `dev` environment only, since production never generates. Generated files print through `nette/php-generator`'s `PsrPrinter` (ADR 0015) and pass `php -l` and PHPStan at level max on PHP 8.3 with Symfony 7.4 and on PHP 8.5 with Symfony 7.4 and 8.x.
