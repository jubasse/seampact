<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\ApiSchemaInvalidParams;

/**
 * The error 'api.schema_invalid'.
 */
final class ApiSchemaInvalidError extends TasksContractException
{
    public const CODE = 'api.schema_invalid';
    public const STATUS = 400;

    public function __construct(
        public readonly ApiSchemaInvalidParams $params,
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
