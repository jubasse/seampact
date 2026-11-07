<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.not_found'.
 */
final class ApiNotFoundError extends TasksContractException
{
    public const CODE = 'api.not_found';
    public const STATUS = 404;

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
