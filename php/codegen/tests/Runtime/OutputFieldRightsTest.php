<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Codegen\Runtime\Denial;
use Seampact\Codegen\Runtime\FieldRights;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\Decision;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\RequirementRequest;

/** Restricted output members: each use site of a right is decided with its own params and pointer. */
final class OutputFieldRightsTest extends TestCase
{
    public function testTwoMembersOfOneRightWithOtherParamsAreDecidedApart(): void
    {
        self::assertEquals((object) ['taskId' => 't1', 'title' => 'Write'], self::visibleTask('getTask', self::editorDecider()));
    }

    public function testTwoMembersOfOneRightWithEqualParamsAreDecidedByPointer(): void
    {
        self::assertEquals((object) ['taskId' => 't1', 'title' => 'Write'], self::visibleTask('listTasks', self::titleDecider()));
    }

    private static function visibleTask(string $operationId, Decider $decider): mixed
    {
        $state = new BoundaryState(ApiContract::of(TypedParamsContract::class), $operationId, [], new RequestView('GET', '/v1/tasks/1', []), self::lookup($decider));
        $task = (object) ['taskId' => 't1', 'effort' => 3, 'title' => 'Write'];

        return FieldRights::output($state, ['body' => ['schema' => 'Task'], 'shape' => 'object'], $task);
    }

    // Allows `roles` when its params let an editor in.
    private static function editorDecider(): Decider
    {
        return new class () implements Decider {
            public function names(): array
            {
                return ['roles'];
            }

            public function decide(RequirementRequest $request): Decision
            {
                $params = $request->params();
                if ($params instanceof TypedParamsRoles && in_array('editor', $params->allowed, true)) {
                    return new Decision\Allowed();
                }

                return new Decision\Denied(new Denial('api.forbidden'));
            }
        };
    }

    // Allows `roles` for the field `/title` only, whatever the params.
    private static function titleDecider(): Decider
    {
        return new class () implements Decider {
            public function names(): array
            {
                return ['roles'];
            }

            public function decide(RequirementRequest $request): Decision
            {
                $purpose = $request->purpose();
                if ($purpose instanceof Purpose\Field && $purpose->pointer === '/title') {
                    return new Decision\Allowed();
                }

                return new Decision\Denied(new Denial('api.forbidden'));
            }
        };
    }

    // A lookup whose only decider is `$decider`.
    private static function lookup(Decider $decider): HookLookup
    {
        return new class ($decider) implements HookLookup {
            public function __construct(private readonly Decider $decider)
            {
            }

            public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
            {
                throw new \LogicException('not called by an output field right');
            }

            public function deciders(ApiContract $contract): iterable
            {
                return [$this->decider];
            }

            public function scopeResolvers(ApiContract $contract): iterable
            {
                return [];
            }

            public function unexpectedErrorListener(ApiContract $contract): ?UnexpectedErrorListener
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

            public function isNotFoundDenial(\Throwable $failure): bool
            {
                return false;
            }
        };
    }
}
