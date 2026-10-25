<?php

declare(strict_types=1);

namespace Seampact\Hooks\ScopeIdSource;

use Seampact\Hooks\ScopeIdSource;
use Seampact\Hooks\RequestView;

/** The application finds the id in the request. */
final readonly class Custom implements ScopeIdSource
{
    public function __construct(
        public RequestView $request,
    ) {
    }
}
