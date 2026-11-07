<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.reauthentication_required'.
 */
final class ApiReauthenticationRequiredError extends TasksContractException
{
    public const CODE = 'api.reauthentication_required';
    public const STATUS = 401;

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
