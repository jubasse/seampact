<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\Tests\Support\MarkedHandler;
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
    public function testAContractRouteApiPlatformRegisteredIsMarkedByItsOperationAlone(): void
    {
        $request = new Request(attributes: ['_api_operation_name' => 'seampact.tasks.getTask']);

        self::assertSame('getTask', $this->subscriber()->marked(self::event($request), 'getTask'));
    }

    public function testARouteThatIsNotTheContractsCarriesNoMark(): void
    {
        $request = new Request(attributes: ['_api_operation_name' => 'other']);

        self::assertNull($this->subscriber()->marked(self::event($request), null));
    }

    public function testAHandlerMethodReachedThroughAnAppRouteStaysMarkedByItsAttribute(): void
    {
        $event = self::event(new Request(), [new MarkedHandler(), 'getTask']);

        self::assertSame('getTask', $this->subscriber()->marked($event, null));
    }

    public function testAPlainRouteReusingTheContractNameIsNotMarkedAsTheContractsOwn(): void
    {
        self::assertNull($this->subscriber()->marked(self::event(new Request()), 'getTask'));
    }

    /** @param callable(): mixed $controller */
    private static function event(Request $request, callable $controller = null): ControllerEvent
    {
        return new ControllerEvent(self::createStub(HttpKernelInterface::class), $controller ?? static fn (): null => null, $request, HttpKernelInterface::MAIN_REQUEST);
    }

    private function subscriber(): MarkedOperationSubscriber
    {
        return new MarkedOperationSubscriber($this->createStub(HookLookup::class), $this->createStub(ContractSettings::class), $this->createStub(ValidatorInterface::class));
    }
}
