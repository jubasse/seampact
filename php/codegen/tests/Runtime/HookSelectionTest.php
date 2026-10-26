<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\HookSelection;
use Seampact\Codegen\Runtime\ScopeResolver;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ScopeResolution;

final class HookSelectionTest extends TestCase
{
    public function testADeciderNamingTheRightWinsOverAnEarlierOneNamingEveryName(): void
    {
        $everyName = self::decider([Decider::EVERY_NAME]);
        $named = self::decider(['tasks.read']);

        $hooks = self::lookup([$everyName, $named], []);

        self::assertSame($named, HookSelection::decider($hooks, self::contract(), 'tasks.read'));
        self::assertSame($everyName, HookSelection::decider($hooks, self::contract(), 'tasks.write'));
    }

    public function testTheFirstDeciderNamingTheRightWins(): void
    {
        $first = self::decider(['tasks.read']);
        $second = self::decider(['tasks.read']);

        self::assertSame($first, HookSelection::decider(self::lookup([$first, $second], []), self::contract(), 'tasks.read'));
    }

    public function testNoDeciderForTheNameIsNull(): void
    {
        self::assertNull(HookSelection::decider(self::lookup([self::decider(['tasks.read'])], []), self::contract(), 'tasks.write'));
    }

    public function testARegisteredDeciderOfTheWrongTypeIsRefusedByName(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("a decider registered for the api 'tasks' (stdClass) does not implement");
        HookSelection::decider(self::lookup([new \stdClass()], []), self::contract(), 'tasks.read');
    }

    public function testTheScopeResolverOfTheScopeIsPicked(): void
    {
        $workspace = self::scopeResolver('workspace');
        $project = self::scopeResolver('project');

        $hooks = self::lookup([], [$workspace, $project]);

        self::assertSame($project, HookSelection::scopeResolver($hooks, self::contract(), 'project'));
        self::assertNull(HookSelection::scopeResolver($hooks, self::contract(), 'team'));
    }

    public function testARegisteredScopeResolverOfTheWrongTypeIsRefusedByName(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("a scope resolver registered for the api 'tasks' (stdClass) does not implement");
        HookSelection::scopeResolver(self::lookup([], [new \stdClass()]), self::contract(), 'project');
    }

    private static function contract(): ApiContract
    {
        return ApiContract::of(SelectionContract::class);
    }

    /** @param list<string> $names */
    private static function decider(array $names): Decider
    {
        return new class ($names) implements Decider {
            /** @param list<string> $names */
            public function __construct(private readonly array $names)
            {
            }

            public function names(): array
            {
                return $this->names;
            }

            public function decide(RequirementRequest $request): Decision
            {
                return new Decision\Allowed();
            }
        };
    }

    private static function scopeResolver(string $scope): ScopeResolver
    {
        return new class ($scope) implements ScopeResolver {
            public function __construct(private readonly string $scope)
            {
            }

            public function scope(): string
            {
                return $this->scope;
            }

            public function resolveScope(ResolveScopeRequest $request): ScopeResolution
            {
                throw new \LogicException('not called by the selection');
            }
        };
    }

    /**
     * @param list<mixed> $deciders
     * @param list<mixed> $scopeResolvers
     */
    private static function lookup(array $deciders, array $scopeResolvers): HookLookup
    {
        return new class ($deciders, $scopeResolvers) implements HookLookup {
            /**
             * @param list<mixed> $deciders
             * @param list<mixed> $scopeResolvers
             */
            public function __construct(private readonly array $deciders, private readonly array $scopeResolvers)
            {
            }

            public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
            {
                throw new \LogicException('not called by the selection');
            }

            public function deciders(ApiContract $contract): iterable
            {
                return $this->deciders;
            }

            public function scopeResolvers(ApiContract $contract): iterable
            {
                return $this->scopeResolvers;
            }

            public function unexpectedErrorListener(): ?UnexpectedErrorListener
            {
                return null;
            }

            public function logger(): LoggerInterface
            {
                return new NullLogger();
            }

            public function isAccessDenial(\Throwable $failure): bool
            {
                return false;
            }
        };
    }
}
