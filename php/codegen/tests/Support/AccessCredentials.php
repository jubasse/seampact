<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** The credentials class of AccessContract's identity: the bearer token and the session cookie found. */
final readonly class AccessCredentials
{
    public function __construct(public ?string $token = null, public ?string $cookie = null)
    {
    }
}
