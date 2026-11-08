<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\ApiPayloadTooLargeParams;

/**
 * The error 'api.payload_too_large'.
 */
final class ApiPayloadTooLargeError extends TasksContractException
{
    public const CODE = 'api.payload_too_large';
    public const STATUS = 413;

    public function __construct(
        public readonly ApiPayloadTooLargeParams $params,
    ) {
        parent::__construct(self::CODE);
    }

    public function contractCode(): string
    {
        return self::CODE;
    }

    public function status(): int
    {
        return self::STATUS;
    }
}
