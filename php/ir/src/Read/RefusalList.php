<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/**
 * The refusals of one check, stopping after 100: a pointer repeats every map key above it, so an unbounded list
 * of refusals under a long key would copy that key without bound.
 */
final class RefusalList
{
    public const MAX_REFUSALS = 100;

    /** @var list<IrRefusal> */
    private array $refusals = [];

    public function isFull(): bool
    {
        return count($this->refusals) >= self::MAX_REFUSALS;
    }

    public function add(IrRefusal $refusal): void
    {
        if (!$this->isFull()) {
            $this->refusals[] = $refusal;
        }
    }

    /** @return list<IrRefusal> */
    public function all(): array
    {
        return $this->refusals;
    }
}
