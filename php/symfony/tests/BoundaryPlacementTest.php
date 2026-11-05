<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Golden\Tasks\HealthInput;
use Seampact\Golden\Tasks\HealthResponse200;
use Seampact\Golden\Tasks\HealthResult;
use Seampact\Golden\Tasks\Schemas\Health;
use Seampact\Golden\Tasks\Symfony\Decider;
use Seampact\Golden\Tasks\Symfony\ScopeResolver;
use Seampact\Golden\Tasks\Symfony\SeampactOperation;
use Seampact\Golden\Tasks\Symfony\TasksBoundary;
use Seampact\Golden\Tasks\Symfony\TasksContract;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver;
use Seampact\Golden\Tasks\Symfony\TasksSettings;
use Seampact\Golden\Tasks\Symfony\UserAuthenticateHook;
use Seampact\Symfony\Runtime\Hooks;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Controller\ArgumentResolver;
use Symfony\Component\HttpKernel\Controller\ArgumentResolverInterface;
use Symfony\Component\HttpKernel\Controller\ControllerResolverInterface;
use Symfony\Component\HttpKernel\ControllerMetadata\ArgumentMetadata;
use Symfony\Component\HttpKernel\HttpKernel;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Validation;

/**
 * The boundary in a real HttpKernel, as the kernel.controller listener of the generated bundle is placed: it checks the request before any
 * argument is resolved, and the value resolver only hands the controller the input the listener stored.
 */
final class BoundaryPlacementTest extends TestCase
{
    private int $argumentResolutions = 0;

    private ?object $receivedInput = null;

    public function testARequestTheContractRefusesNeverReachesTheArgumentResolver(): void
    {
        $response = $this->handle('/v1/health?unknown=1');

        self::assertSame(400, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(0, $this->argumentResolutions);
        self::assertNull($this->receivedInput);
    }

    public function testTheValueResolverHandsTheControllerOnlyTheInputTheListenerStored(): void
    {
        $response = $this->handle('/v1/health');

        self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(1, $this->argumentResolutions);
        self::assertInstanceOf(HealthInput::class, $this->receivedInput);
    }

    private function handle(string $uri): Response
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addSubscriber(new TasksBoundary(
            $this->hooks(),
            new TasksSettings('strict', true, []),
            Validation::createValidatorBuilder()->getValidator(),
        ));

        $kernel = new HttpKernel($dispatcher, $this->controllerResolver(), new RequestStack(), $this->countingArgumentResolver());
        $request = Request::create($uri);
        $request->attributes->set('_route', ApiContract::of(TasksContract::class)->routeName('health'));
        $request->attributes->set('_seampact_operation', 'health');

        return $kernel->handle($request, HttpKernelInterface::MAIN_REQUEST, true);
    }

    private function hooks(): Hooks
    {
        $authenticate = $this->createStub(UserAuthenticateHook::class);
        $scope = $this->createConfiguredStub(ScopeResolver::class, ['scope' => 'channel']);
        $decider = $this->createConfiguredStub(Decider::class, ['names' => ['tasks.seeEffort']]);

        return new Hooks(new ServiceLocator([UserAuthenticateHook::class => static fn (): UserAuthenticateHook => $authenticate]), [$decider], [$scope], null, new NullLogger());
    }

    private function controllerResolver(): ControllerResolverInterface
    {
        $controller = new class ($this) {
            public function __construct(private readonly BoundaryPlacementTest $test)
            {
            }

            #[SeampactOperation('health')]
            public function health(HealthInput $input): HealthResult
            {
                $this->test->received($input);

                return new HealthResponse200(new Health('ok'));
            }
        };

        return new class ($controller->health(...)) implements ControllerResolverInterface {
            public function __construct(private readonly \Closure $controller)
            {
            }

            public function getController(Request $request): callable
            {
                return $this->controller;
            }
        };
    }

    private function countingArgumentResolver(): ArgumentResolverInterface
    {
        $real = new ArgumentResolver(null, [new TasksInputResolver()]);

        return new class ($real, function (): void { $this->argumentResolutions++; }) implements ArgumentResolverInterface {
            public function __construct(private readonly ArgumentResolver $real, private readonly \Closure $counted)
            {
            }

            /** @return array<mixed> */
            public function getArguments(Request $request, callable $controller, ?\ReflectionFunctionAbstract $reflector = null): array
            {
                ($this->counted)();

                return $this->real->getArguments($request, $controller, $reflector);
            }
        };
    }

    public function received(object $input): void
    {
        $this->receivedInput = $input;
    }
}
