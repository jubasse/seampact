<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\IdempotencyStore;

/** A hook lookup that also finds the app's idempotency store, for a target that serves idempotent writes. */
interface IdempotencyStoreLookup
{
    /** The app's registered store, null when it registers none. */
    public function idempotencyStore(): ?IdempotencyStore;
}
