<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/**
 * Marks a controller method as the handler of one contract operation. The boundary reads it from the resolved
 * controller and refuses a contract route whose method lacks it, or a method carrying it on a route that is not the
 * contract's.
 */
#[\Attribute(\Attribute::TARGET_METHOD)]
final readonly class SeampactOperation
{
    public function __construct(public string $operationId)
    {
    }
}
