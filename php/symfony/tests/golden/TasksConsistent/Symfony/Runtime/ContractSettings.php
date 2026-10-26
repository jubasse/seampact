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
    /** The named argument of the settings service holding `public_origin`, which the boot check reads. */
    public const PUBLIC_ORIGIN_ARGUMENT = '$publicOrigin';
    /** The constant of the generated settings class naming its bundle configuration alias, such as `seampact_tasks`. */
    public const ALIAS_CONSTANT = 'ALIAS';

    /** The outgoing check's mode of an operation, `strict` or `warn`. */
    public function responsesOf(string $operationId): string;

    public function bodyValidation(): bool;

    /** The origin the api's URLs start with under absolute URLs, null under relative ones. */
    public function publicOrigin(): ?string;
}
