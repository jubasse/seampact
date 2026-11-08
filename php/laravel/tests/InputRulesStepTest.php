<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\Factory as ValidatorFactory;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Application;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use PHPUnit\Framework\TestCase;
use Psr\Log\AbstractLogger;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\StoredResponse;
use Seampact\Laravel\Runtime\Hooks;
use Seampact\Laravel\Runtime\InputRules;
use Seampact\Laravel\Runtime\InputRulesStep;

/** Step 8b: the app's rules run over each part as the handler gets it, and a refusal names the rule and the member and releases the claim. */
final class InputRulesStepTest extends TestCase
{
    private const CLAIMED_KEY = 'claimed-key';

    public function testRulesThatPassLetTheHandlerRun(): void
    {
        $this->expectNotToPerformAssertions();

        self::runStep(self::served([self::rules('body', ['end' => ['after:start']])]));
    }

    public function testABuiltInRuleAnswersItsNameAtTheMember(): void
    {
        $served = self::served([self::rules('body', ['end' => ['after:start']])], end: '2026-01-01');

        self::assertSame([['in' => 'body', 'pointer' => '/end', 'rule' => 'app.after']], self::issues($served));
    }

    public function testARuleClassAnswersItsShortNameFirstLetterLowered(): void
    {
        $served = self::served([self::rules('body', ['end' => [new EndNotBeforeStart()]])], end: '2026-01-01');

        self::assertSame([['in' => 'body', 'pointer' => '/end', 'rule' => 'app.endNotBeforeStart']], self::issues($served));
    }

    public function testARuleOnThePartItselfPointsAtTheRoot(): void
    {
        $served = self::served([self::rules('body', ['' => [new WindowTooLong()]])]);

        self::assertSame([['in' => 'body', 'pointer' => '', 'rule' => 'app.windowTooLong']], self::issues($served));
    }

    public function testAClosureAnswersTheInvalidNameAndLogsTheFixOnce(): void
    {
        $closure = static function (string $attribute, mixed $value, Closure $fail): void {
            $fail('too long');
        };
        $served = self::served([self::rules('body', ['note' => [$closure]])], note: 'unnamed');

        self::assertSame([['in' => 'body', 'pointer' => '/note', 'rule' => 'app.invalid']], self::issues($served));
        self::issues($served);
        self::assertCount(1, $served->logger->lines);
        self::assertStringContainsString('has no usable name', $served->logger->lines[0]);
    }

    public function testAnIssueOfEveryPartIsAnsweredTogetherInPartOrder(): void
    {
        $served = self::served(
            [self::rules('body', ['end' => ['after:start']]), self::rules('query', ['dryRun' => ['accepted']]), self::rules('headers', ['x-tenant' => ['in:other']])],
            end: '2026-01-01',
        );

        self::assertSame([
            ['in' => 'query', 'pointer' => '/dryRun', 'rule' => 'app.accepted'],
            ['in' => 'header', 'pointer' => '/x-tenant', 'rule' => 'app.in'],
            ['in' => 'body', 'pointer' => '/end', 'rule' => 'app.after'],
        ], self::issues($served));
    }

    public function testRulesOfAnotherOperationDoNotRun(): void
    {
        $this->expectNotToPerformAssertions();

        self::runStep(self::served([self::rules('body', ['end' => ['after:start']], 'getTask')], end: '2026-01-01'));
    }

    public function testARefusalReleasesTheClaimAndClearsTheKey(): void
    {
        $store = new AbandonRecordingStore();
        $served = self::served([self::rules('body', ['end' => ['after:start']])], end: '2026-01-01', store: $store);

        self::issues($served);

        self::assertSame([self::CLAIMED_KEY], $store->abandoned);
        self::assertNull($served->state->idempotencyKey);
    }

    public function testARuleThatThrowsIsABoundaryFailureWithoutItsMessage(): void
    {
        $throwing = static function (): never {
            throw new \RuntimeException('secret detail');
        };
        $served = self::served([self::rules('body', ['end' => [$throwing]])]);

        try {
            self::runStep($served);
            self::fail('The rule that threw let the request through.');
        } catch (BoundaryFailure $failure) {
            self::assertSame("an input rule of the part 'body' threw", $failure->reason);
            self::assertStringNotContainsString('secret detail', $failure->getMessage());
        }
    }

    public function testTheRulesSeeTheTypedPartAsWireKeysWithAnAbsentOptionalMemberLeftOut(): void
    {
        $seen = [];
        $spy = static function (string $attribute, mixed $value, Closure $fail) use (&$seen): void {
            $seen[$attribute] = $value;
        };
        $rules = [
            self::rules('body', ['start' => [$spy], 'note' => ['sometimes', $spy]]),
            self::rules('headers', ['x-tenant' => [$spy]]),
        ];

        self::runStep(self::served($rules));

        self::assertSame(['start' => '2026-01-02', 'x-tenant' => 'acme'], $seen);
    }

    /** @param list<InputRules> $rules */
    private static function served(array $rules, string $end = '2026-01-03', ?string $note = null, ?IdempotencyStore $store = null): ServedRequest
    {
        $logger = new RecordingLogger();
        $app = new Application(sys_get_temp_dir());
        $app->instance(ValidatorFactory::class, new Factory(new Translator(new ArrayLoader(), 'en')));
        $app->instance(LoggerInterface::class, $logger);
        foreach ($rules as $index => $set) {
            $app->instance("rules.{$index}", $set);
        }
        $app->tag(array_map(static fn (int $index): string => "rules.{$index}", array_keys($rules)), Hooks::inputRulesTag('tasks'));

        $state = new BoundaryState(ApiContract::of(InputRulesContract::class), 'scheduleTask', [], new RequestView('POST', '/v1/tasks/schedule', []), new Hooks($app));
        if ($store !== null) {
            $app->instance(Hooks::idempotencyStoreKey('tasks'), $store);
            $state->idempotencyKey = self::CLAIMED_KEY;
        }
        $input = new ScheduleInput(new ScheduleQuery(), new ScheduleHeaders('acme'), new ScheduleWindow('2026-01-02', $end, $note));

        return new ServedRequest($state, $input, $logger);
    }

    private static function runStep(ServedRequest $served): void
    {
        InputRulesStep::run($served->state, $served->input);
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

    /** @param array<string, mixed> $rules */
    private static function rules(string $part, array $rules, string $operationId = 'scheduleTask'): InputRules
    {
        return new ScriptedInputRules($operationId, $part, $rules);
    }
}

/** A request at step 8b: its state, the typed input and the logger the app's lines go to. */
final class ServedRequest
{
    public function __construct(public readonly BoundaryState $state, public readonly ScheduleInput $input, public readonly RecordingLogger $logger)
    {
    }
}

/** Input rules of one operation and part, with the rules the test gives. */
final class ScriptedInputRules implements InputRules
{
    /** @param array<string, mixed> $rules */
    public function __construct(private readonly string $operationId, private readonly string $part, private readonly array $rules)
    {
    }

    public function operationId(): string
    {
        return $this->operationId;
    }

    public function part(): string
    {
        return $this->part;
    }

    public function rules(): array
    {
        return $this->rules;
    }
}

/** A named rule: the end is not before the start. */
final class EndNotBeforeStart implements ValidationRule, DataAwareRule
{
    /** @var array<string, mixed> */
    private array $data = [];

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && $value < ($this->data['start'] ?? '')) {
            $fail('the end is before the start');
        }
    }

    /** @param array<string, mixed> $data */
    public function setData(array $data): static
    {
        $this->data = $data;

        return $this;
    }
}

/** A rule on the part itself: it runs though no member carries it, and fails always. */
final class WindowTooLong implements ValidationRule
{
    public bool $implicit = true;

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $fail('the window is too long');
    }
}

/** A logger that keeps its lines. */
final class RecordingLogger extends AbstractLogger
{
    /** @var list<string> */
    public array $lines = [];

    public function log(mixed $level, string|\Stringable $message, array $context = []): void
    {
        $this->lines[] = (string) $message;
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
