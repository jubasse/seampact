<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Hooks\RequirementKind;

/** The params a generated contract's operation declares where it asks a right or rule: what the boundary hands to RequirementParams. */
final class RequirementUseSite
{
    private function __construct()
    {
    }

    public static function params(ApiContract $contract, string $operationId, RequirementKind $kind, string $name): mixed
    {
        foreach (Ir::maps($contract->operation($operationId), 'requires') as $requirement) {
            if (Ir::string($requirement, 'kind') === $kind->value && Ir::string($requirement, $kind->value) === $name) {
                return $requirement['params'] ?? null;
            }
        }

        throw new \LogicException("The operation '{$operationId}' asks no {$kind->value} '{$name}'.");
    }
}
