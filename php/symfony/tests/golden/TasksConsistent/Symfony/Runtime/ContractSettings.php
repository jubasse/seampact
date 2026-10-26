<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * The api's run-time settings from its bundle configuration, each checked when the boundary reads it: a value the
 * configuration cannot hold is an `UnexpectedValueException` naming the key, which the boundary answers with the api's
 * 500.
 */
interface ContractSettings
{
    /** The outgoing check's mode of an operation, `strict` or `warn`. */
    public function responsesOf(string $operationId): string;

    public function bodyValidation(): bool;
}
