<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/**
 * The base of each api's generated `SeampactOperation` attribute, which marks a controller method as the handler of
 * one contract operation. The boundary reads its own api's attribute from the resolved controller and refuses a
 * contract route whose method lacks it, or a method carrying it on a route that is not the contract's; an attribute
 * per api keeps one api's handlers out of another's checks.
 */
abstract readonly class OperationMark
{
    public function __construct(public string $operationId)
    {
    }
}
