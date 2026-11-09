### The consumer and the proof

The sample app lives in `scripts/consumers/targets/laravel/`. It is a Laravel 13 skeleton that holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a `MessageLogged` listener. Each request of PHP's built-in server starts from nothing, so the script, the hook calls and the log lines live in one file under `storage/`. It reads the template's credentials from the shared JSON. It installs `seampact/hooks`, `seampact/laravel` and `seampact/ir` from Composer path repositories pointing at the split trees (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle that the workflow built.

The workflow `p6-laravel.yml` has, beside `changes` and the `packages` tests:

- `contract-bundle` (Node), which bundles the reference contract and its pack-laravel variant with the compiler binary (ADR 0011 "The bundle"); the consumer fetches it from a local git repository with its integrity pin;
- `e2e`, a matrix on the latest PHP 8.3 and 8.5, both pull-request rows. Node is removed from the runner first, and the step fails if `node`, `npm` or `npx` is still found. It installs the app, its allow-listed variant and its pack-laravel variant (the contract with `@seampact/pack-laravel` applied, bundled by `contract-bundle` too, its paged lists answering `LengthAwarePaginator`) with Composer only, generates from the bundles and runs `route:cache` and `config:cache`. Node then comes back for the suite alone, which serves the app with PHP's built-in server (`php -S`, no php-fpm or nginx) and runs the `default`, `hand-written`, `boot` and `pack:laravel` profiles, as the spring-boot consumer runs them (ADR 0015 "Suite profiles"); a boot is `route:cache`, which runs the boot check. The local-YAML rows, through the compiler binary, come with php-core-4;
- `laravel`, the aggregate, failing on any failed or cancelled job, or one skipped although `changes` said run.

The proof is:

- the `node`-absent step;
- a green suite row per PHP version;
- `php/laravel`'s `RedactionTest.php` (one generated class of each kind of "Redaction" in the golden, holding a known secret, which `var_dump`, `print_r` and VarDumper must not show while `[redacted]` is present) and the suite's security and media rows, a Sanctum route among them.

The suite runs every case of the reference contract: the consumer's refusal list is empty. The suite resolves a captured link against the URL of the request it came from (RFC 3986), so `pack-laravel-page-next-link` follows the query-only next link a relative-URL page writes.
