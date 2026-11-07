<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** Why the compiler binary is not run: the code, what was found, and the fix. */
final readonly class BinaryFailure
{
    public function __construct(public BinaryFailureCode $code, public string $message, public string $fix)
    {
    }
}
