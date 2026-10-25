<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The compiler binary is refused before or while it runs; `failure` names the code and the fix. */
final class BinaryRefusedException extends \RuntimeException
{
    public function __construct(public readonly BinaryFailure $failure)
    {
        parent::__construct("{$failure->code->value}: {$failure->message} {$failure->fix}");
    }

    public static function of(BinaryFailureCode $code, string $message, string $fix): self
    {
        return new self(new BinaryFailure($code, $message, $fix));
    }
}
