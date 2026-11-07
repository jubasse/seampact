<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.csrf_invalid'.
 */
final class ApiCsrfInvalidError extends TasksContractException
{
    public const CODE = 'api.csrf_invalid';
    public const STATUS = 403;

    public function __construct()
    {
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
