<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Runtime;

use Seampact\Symfony\Runtime\BoundarySubscriber;
use Symfony\Component\HttpKernel\Event\ControllerEvent;

/**
 * The boundary of an api served by API Platform (ADR 0029 "The operation marker"): the resolved controller is always
 * API Platform's main controller, which no handler method sits behind, so a contract route that API Platform registered is
 * marked by its name and its operation default alone. The bypass check the method attribute gave moves to the generated processors.
 */
abstract class ApiPlatformBoundarySubscriber extends BoundarySubscriber
{
    private const OPERATION_NAME_ATTRIBUTE = '_api_operation_name';

    /** Only a route API Platform registered is marked by the route; any other route keeps the handler attribute's mark. */
    protected function markedOperation(ControllerEvent $event, ?string $routeOperation): ?string
    {
        if ($event->getRequest()->attributes->has(self::OPERATION_NAME_ATTRIBUTE)) {
            return $routeOperation;
        }

        return parent::markedOperation($event, $routeOperation);
    }
}
