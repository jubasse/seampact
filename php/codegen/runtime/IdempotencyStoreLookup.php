<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\IdempotencyStore;

/** A hook lookup that also finds the idempotency store the app registered for each api, for a target that serves idempotent writes. */
interface IdempotencyStoreLookup
{
    /** The store the app registered for the api, null when it registers none. */
    public function idempotencyStore(ApiContract $contract): ?IdempotencyStore;
}
