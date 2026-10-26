<?php

declare(strict_types=1);

namespace Seampact\Symfony\Shared;

use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Write\GeneratedFile;

/**
 * The framework-neutral part of one api's generated code, which the PHP targets share: the forms the entry keeps,
 * every PHP name of the value types, inputs, results and exceptions, and their files. The Symfony placement reads
 * only these names and never writes those types itself.
 */
interface SharedTypes
{
    /** @return list<array{int, Operation}> each kept operation with its index in the IR */
    public function operations(): array;

    /**
     * The header params that reach the handler; a credential header is the authenticate step's.
     *
     * @return list<Param>
     */
    public function handlerHeaders(Operation $operation): array;

    /** The api's type name, the prefix of the Symfony placement classes (`Tasks`). */
    public function apiTypeName(): string;

    public function operation(string $operationId): OperationTypeNames;

    /** The exception class of a declared error code, null for one the shared types do not write. */
    public function errorClass(string $code): ?string;

    /** @return list<GeneratedFile> the value types, inputs, results and exceptions, each path relative to the output directory */
    public function files(): array;
}
