<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\Tests\Support\MarkedOperationSubscriber;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Symfony\Runtime\ContractSettings;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/** The operation marker, read from the contract route because the resolved controller is never a handler method. */
final class ApiPlatformBoundarySubscriberTest extends TestCase
{
    public function testAContractRouteIsMarkedByItsOperationAlone(): void
    {
        self::assertSame('getTask', $this->subscriber()->marked(self::event(), 'getTask'));
    }

    public function testARouteThatIsNotTheContractsCarriesNoMark(): void
    {
        self::assertNull($this->subscriber()->marked(self::event(), null));
    }

    private static function event(): ControllerEvent
    {
        return new ControllerEvent(self::createStub(HttpKernelInterface::class), static fn (): null => null, new Request(), HttpKernelInterface::MAIN_REQUEST);
    }

    private function subscriber(): MarkedOperationSubscriber
    {
        return new MarkedOperationSubscriber($this->createStub(HookLookup::class), $this->createStub(ContractSettings::class), $this->createStub(ValidatorInterface::class));
    }
}
