<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests\Support;

use Seampact\ApiPlatform\Runtime\ApiPlatformBoundarySubscriber;
use Seampact\Symfony\Runtime\OperationMark;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\Validator\Constraint;

/** A boundary subscriber with nothing generated behind it, which shows the operation marker it reads. */
final class MarkedOperationSubscriber extends ApiPlatformBoundarySubscriber
{
    public function marked(ControllerEvent $event, ?string $routeOperation): ?string
    {
        return $this->markedOperation($event, $routeOperation);
    }

    protected function contractClass(): string
    {
        return \stdClass::class;
    }

    protected function inputConstraint(string $operationId): Constraint
    {
        throw new \LogicException('not used');
    }

    protected function inputAttribute(): string
    {
        return '_input';
    }

    protected function operationAttribute(): string
    {
        return OperationMark::class;
    }

    protected function contractExceptionClass(): string
    {
        return \RuntimeException::class;
    }

    protected function checksHooks(): bool
    {
        return false;
    }
}
