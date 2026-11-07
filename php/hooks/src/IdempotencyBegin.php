<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** What the store answers when an idempotent write begins; only the classes under IdempotencyBegin implement it. */
interface IdempotencyBegin
{
}
