<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\RequirementCall;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\Decision;
use Seampact\Hooks\FieldDirection;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\RequirementKind;
use Seampact\Hooks\RequirementRequest;

/**
 * A framework denial a decider throws: a plain one answers the requirement's first denial code, one that hides the
 * record (Laravel's `denyAsNotFound()`) the operation's not-found code when it declares one and a route requirement
 * denied, so a field right keeps its own code.
 */
final class NotFoundDenialTest extends TestCase
{
    public function testADenialHidingTheRecordAnswersTheOperationsNotFoundCode(): void
    {
        self::assertSame('api.not_found', self::deniedCode('getTask', new \OutOfBoundsException('hidden')));
    }

    public function testADenialHidingTheRecordAnswersTheFirstDenialCodeWhenTheOperationHasNoNotFoundCode(): void
    {
        self::assertSame('tasks.not_owner', self::deniedCode('archiveTasks', new \OutOfBoundsException('hidden')));
    }

    public function testAPlainDenialAnswersTheFirstDenialCode(): void
    {
        self::assertSame('tasks.not_owner', self::deniedCode('getTask', new \DomainException('denied')));
    }

    public function testAFieldRightsDenialHidingTheRecordKeepsTheFirstDenialCode(): void
    {
        $fieldPurpose = new Purpose\Field('/title', FieldDirection::Input);

        self::assertSame('tasks.not_owner', self::deniedCode('getTask', new \OutOfBoundsException('hidden'), $fieldPurpose));
    }

    private static function deniedCode(string $operationId, \Throwable $denial, ?Purpose $purpose = null): string
    {
        $state = new BoundaryState(ApiContract::of(NotFoundDenialContract::class), $operationId, [], new RequestView('GET', '/v1/tasks/1', []), self::lookup($denial));
        $call = new RequirementCall(RequirementKind::Rule, 'tasks.owner', null, null, null, [], null, $purpose ?? new Purpose\Route(), new OperationRef('tasks', $operationId), $state->view);

        $decision = AccessSteps::decide($state, $call);

        self::assertInstanceOf(Decision\Denied::class, $decision);

        return $decision->deny->code();
    }

    // A decider that throws `$denial`; the lookup reads a `DomainException` as a plain denial, an `OutOfBoundsException` as one hiding the record.
    private static function lookup(\Throwable $denial): HookLookup
    {
        $decider = new class ($denial) implements Decider {
            public function __construct(private readonly \Throwable $denial)
            {
            }

            public function names(): array
            {
                return ['tasks.owner'];
            }

            public function decide(RequirementRequest $request): Decision
            {
                throw $this->denial;
            }
        };

        return new class ($decider) implements HookLookup {
            public function __construct(private readonly Decider $decider)
            {
            }

            public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
            {
                throw new \LogicException('not called by a decider');
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
                return $failure instanceof \DomainException || $failure instanceof \OutOfBoundsException;
            }

            public function isNotFoundDenial(\Throwable $failure): bool
            {
                return $failure instanceof \OutOfBoundsException;
            }
        };
    }
}
