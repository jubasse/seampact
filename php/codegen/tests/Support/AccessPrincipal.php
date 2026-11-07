<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** The principal members interface of AccessContract's identity. */
interface AccessPrincipal
{
    public function userId(): string;
}
