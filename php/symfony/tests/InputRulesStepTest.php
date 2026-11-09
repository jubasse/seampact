<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\StoredResponse;
use Seampact\Symfony\Runtime\Hooks;
use Seampact\Symfony\Runtime\InputRules;
use Seampact\Symfony\Runtime\InputRulesStep;
use Seampact\Symfony\Runtime\Rule;
use Seampact\Symfony\Tests\Support\DirectInputRules;
use Seampact\Symfony\Tests\Support\InputRulesContract;
use Seampact\Symfony\Tests\Support\RecordingLogger;
use Seampact\Symfony\Tests\Support\ScheduleHeaders;
use Seampact\Symfony\Tests\Support\ScheduleInput;
use Seampact\Symfony\Tests\Support\ScheduleQuery;
use Seampact\Symfony\Tests\Support\ScheduleWindow;
use Seampact\Symfony\Tests\Support\ScriptedInputRules;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints\Callback;
use Symfony\Component\Validator\Constraints\Sequentially;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Context\ExecutionContextInterface;
use Symfony\Component\Validator\Validation;

/** Step 8b: the app's rules run over each part as the handler gets it, and a refusal names the rule and the member and releases the claim. */
final class InputRulesStepTest extends TestCase
{
    private const CLAIMED_KEY = 'claimed-key';

    public function testRulesThatPassLetTheHandlerRun(): void
    {
        $this->expectNotToPerformAssertions();

        self::runStep(self::served([self::rules('body', new EndNotBeforeStart())]));
    }

    public function testACustomConstraintAnswersItsShortNameFirstLetterLoweredAtTheMember(): void
    {
        $served = self::served([self::rules('body', new EndNotBeforeStart())], end: '2026-01-01');

        self::assertSame([['in' => 'body', 'pointer' => '/end', 'rule' => 'app.endNotBeforeStart']], self::issues($served));
    }

    public function testAPayloadNamedRuleOnThePartItselfPointsAtTheRoot(): void
    {
        $served = self::served([self::rules('body', self::failing('', 'windowTooLong'))]);

        self::assertSame([['in' => 'body', 'pointer' => '', 'rule' => 'app.windowTooLong']], self::issues($served));
    }

    public function testAnUnnamedRuleAnswersTheInvalidNameAndLogsTheFixOnce(): void
    {
        $served = self::served([self::rules('body', self::failing('note', null))], note: 'unnamed');

        self::assertSame([['in' => 'body', 'pointer' => '/note', 'rule' => 'app.invalid']], self::issues($served));
        self::issues($served);
        self::assertCount(1, $served->logger->lines);
        self::assertStringContainsString('has no usable name', $served->logger->lines[0]);
    }

    public function testACompositeConstraintKeepsItsPayloadNameWhenAnInnerConstraintRaisesTheViolation(): void
    {
        $composite = new Sequentially([new Callback(static function (mixed $item, ExecutionContextInterface $context): void {
            $context->buildViolation('refused')->addViolation();
        })], payload: Rule::payload('thenRefused'));
        $served = self::served([self::rules('body', $composite)]);

        self::assertSame([['in' => 'body', 'pointer' => '', 'rule' => 'app.thenRefused']], self::issues($served));
    }

    public function testARuleSetOfNoApiInterfaceIsRefused(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessageMatches('/not a class implementing .*TasksInputRules/');

        self::runStep(self::served([new DirectInputRules()]));
    }

    public function testAnIssueOfEveryPartIsAnsweredTogetherInPartOrder(): void
    {
        $served = self::served([
            self::rules('body', new EndNotBeforeStart()),
            self::rules('query', self::failing('dryRun', 'accepted')),
            self::rules('headers', self::failing('xTenant', 'in')),
        ], end: '2026-01-01');

        self::assertSame([
            ['in' => 'query', 'pointer' => '/dryRun', 'rule' => 'app.accepted'],
            ['in' => 'header', 'pointer' => '/x-tenant', 'rule' => 'app.in'],
            ['in' => 'body', 'pointer' => '/end', 'rule' => 'app.endNotBeforeStart'],
        ], self::issues($served));
    }

    public function testRulesOfAnotherOperationDoNotRun(): void
    {
        $this->expectNotToPerformAssertions();

        self::runStep(self::served([self::rules('body', new EndNotBeforeStart(), 'getTask')], end: '2026-01-01'));
    }

    public function testARefusalReleasesTheClaimAndClearsTheKey(): void
    {
        $store = new AbandonRecordingStore();
        $served = self::served([self::rules('body', new EndNotBeforeStart())], end: '2026-01-01', store: $store);

        self::issues($served);

        self::assertSame([self::CLAIMED_KEY], $store->abandoned);
        self::assertNull($served->state->idempotencyKey);
    }

    public function testARuleThatThrowsIsABoundaryFailureWithTheClassNameAndWithoutTheMessage(): void
    {
        $throwing = new Callback(static function (): never {
            throw new \RuntimeException('secret detail');
        });
        $served = self::served([self::rules('body', $throwing)]);

        try {
            self::runStep($served);
            self::fail('The rule that threw let the request through.');
        } catch (BoundaryFailure $failure) {
            self::assertStringStartsWith("an input rule of the part 'body' threw (", $failure->reason);
            self::assertStringContainsString(ScriptedInputRules::class, $failure->reason);
            self::assertStringNotContainsString('secret detail', $failure->getMessage());
        }
    }

    public function testARuleSetOfAnAbsentPartIsSkipped(): void
    {
        $this->expectNotToPerformAssertions();
        $served = self::served([self::rules('body', self::failing('', 'never'))]);
        $input = new class () {
            public readonly ?ScheduleWindow $body;

            public function __construct()
            {
                $this->body = null;
            }
        };

        InputRulesStep::run($served->state, $input, Validation::createValidator());
    }

    /** @param list<InputRules> $rules */
    private static function served(array $rules, string $end = '2026-01-03', ?string $note = null, ?IdempotencyStore $store = null): ServedRequest
    {
        $logger = new RecordingLogger();
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, $logger, $store, false, $rules);
        $state = new BoundaryState(ApiContract::of(InputRulesContract::class), 'scheduleTask', [], new RequestView('POST', '/v1/tasks/schedule', []), $hooks);
        if ($store !== null) {
            $state->idempotencyKey = self::CLAIMED_KEY;
        }
        $input = new ScheduleInput(new ScheduleQuery(), new ScheduleHeaders('acme'), new ScheduleWindow('2026-01-02', $end, $note));

        return new ServedRequest($state, $input, $logger);
    }

    private static function runStep(ServedRequest $served): void
    {
        InputRulesStep::run($served->state, $served->input, Validation::createValidator());
    }

    /** @return list<array{in: string, pointer: string, rule: string}> */
    private static function issues(ServedRequest $served): array
    {
        try {
            self::runStep($served);
        } catch (ContractRefusal $refusal) {
            $body = json_decode(json_encode($refusal->params, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
            self::assertIsArray($body);
            /** @var list<array{in: string, pointer: string, rule: string}> $listed */
            $listed = $body['issues'];

            return $listed;
        }

        self::fail('The rules let the request through.');
    }

    private static function rules(string $part, Constraint $constraint, string $operationId = 'scheduleTask'): ScriptedInputRules
    {
        return new ScriptedInputRules($operationId, $part, $constraint);
    }

    /** A constraint that always refuses, at `$path` of the part, naming itself `$rule` in its payload unless null. */
    private static function failing(string $path, ?string $rule): Callback
    {
        return new Callback(
            callback: static function (mixed $value, ExecutionContextInterface $context) use ($path): void {
                $context->buildViolation('refused')->atPath($path)->addViolation();
            },
            payload: $rule === null ? null : Rule::payload($rule),
        );
    }
}

/** A request at step 8b: its state, the typed input and the logger the app's lines go to. */
final class ServedRequest
{
    public function __construct(public readonly BoundaryState $state, public readonly ScheduleInput $input, public readonly RecordingLogger $logger)
    {
    }
}

/** A named custom constraint: the end is not before the start. */
final class EndNotBeforeStart extends Constraint
{
    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}

/** The validator of EndNotBeforeStart. */
final class EndNotBeforeStartValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if ($value instanceof ScheduleWindow && $value->end < $value->start) {
            $this->context->buildViolation('the end is before the start')->atPath('end')->addViolation();
        }
    }
}

/** An idempotency store that records the keys it is told to abandon. */
final class AbandonRecordingStore implements IdempotencyStore
{
    /** @var list<string> */
    public array $abandoned = [];

    public function begin(IdempotencyClaim $claim): IdempotencyBegin
    {
        return new IdempotencyBegin\Started();
    }

    public function complete(string $key, StoredResponse $response): void
    {
    }

    public function abandon(string $key): void
    {
        $this->abandoned[] = $key;
    }
}
