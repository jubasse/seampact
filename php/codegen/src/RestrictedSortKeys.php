<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\Operation;

/** Sort keys restricted by a right, which the boundary does not ask yet (ADR 0012 step 7), as on the Spring target. */
final class RestrictedSortKeys
{
    private function __construct()
    {
    }

    /** Refuses by name each sort key of the operation that a right restricts. */
    public static function refuse(Operation $operation, IrPlace $at, Refusals $refusals): void
    {
        foreach ($operation->paging->sortKeys ?? [] as $index => $sortKey) {
            if ($sortKey->right !== null) {
                $refusals->waiting('paging.sortKey.right', "The sort key '{$sortKey->key}' restricted by the right '{$sortKey->right}'", $at->below('paging', 'sortKeys', $index, 'right'), Delivery::Consumer);
            }
        }
    }
}
