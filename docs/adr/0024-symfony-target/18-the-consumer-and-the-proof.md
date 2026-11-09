### The consumer and the proof

The sample app lives in `scripts/consumers/targets/symfony/`. It is a `MicroKernelTrait` kernel without Flex or Monolog, with SecurityBundle and Validator, which holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by the app's `logger` service. Its authenticate hook reads the firewall's user from the token storage (`Security::getUser()` on an `http_basic` login), its decider asks its voter through `isGranted` with a subject carrying params and scopes and counts the throttled user's bucket in a `framework.rate_limiter` factory keyed by the bucket key, its `access_control` rule uses the generated identity matcher chained with a suite header, and an app listener on the same matcher throws an `HttpException` of the status a suite header names; the Symfony edges of the suite check each of them on Symfony 7.4 and 8. It reads the template's credentials from the shared JSON. It installs `seampact/hooks`, `seampact/symfony` and `seampact/ir` from Composer path repositories pointing at the split trees (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle that the workflow built. It serves both apis of the reference contract, with the `tasksService` bundle beside the `tasks` one. The reference contract writes relative URLs, so no `public_origin` is set.

The workflow `p6-symfony.yml` has five jobs:

- `changes`;
- `contract-bundle` (Node), which bundles the reference contract (ADR 0011 "The bundle");
- `e2e`, a matrix of Symfony 7.4 on PHP 8.3 and Symfony 8 on PHP 8.5, in glibc `php` images, whose first step fails when `node`, `npm` or `npx` is found. It installs the app with Composer only, generates from that bundle, runs `cache:warmup --env=prod` as the boot step and serves the app with PHP's built-in server, as the Laravel consumer does (ADR 0023), to the `default`, `hand-written` and `boot` profiles through the suite's CLI (ADR 0015 "Suite profiles"); the local-YAML rows, through the compiler binary, come with php-core-4. A boot case runs `cache:warmup` into a cache directory of its own;
- `symfony`, the aggregate, failing on any failed or cancelled job.

The proof is:

- the `node`-absent step;
- a green suite row per matrix entry;
- `php/symfony/tests/RedactionTest.php`, on the golden classes (one class of each kind of "Redaction" holding a known secret, which `var_dump`, `print_r` and VarDumper must not show while `[redacted]` is present);
- the suite's security rows: a bad-credentials `http_basic` row answering `unauthenticated` through `LoginFailureEvent`, an `access_control` row answering `forbidden`, a `login_throttling` row answering `rateLimited`, and an `access_control` row on a per-kind matcher. The reference contract's core operations declare no 403 and no `rateLimited` role, so the `access_control` and `login_throttling` rows answer the api's 500 and log the role they kept;
- the suite's media rows.

The suite's refusal list is empty: the reference contract carries no form that waits.
