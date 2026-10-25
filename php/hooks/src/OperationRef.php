<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** The operation a hook is called for: its api and its operation id. */
final readonly class OperationRef
{
    public function __construct(
        public string $api,
        public string $id,
    ) {
    }
}
