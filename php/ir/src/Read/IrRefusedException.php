<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** The IR is one this reader must not act on: every reason, named, up to 100 (ADR 0005 sections 2 and 3). */
final class IrRefusedException extends \RuntimeException
{
    /** @param non-empty-list<IrRefusal> $refusals */
    public function __construct(public readonly array $refusals)
    {
        parent::__construct(implode("\n", array_map(
            static fn (IrRefusal $refusal): string => $refusal->code->value . ': ' . $refusal->message,
            $refusals,
        )));
    }
}
