<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Request;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Hooks\RequestView;
use Seampact\Laravel\Runtime\FormSteps;
use Seampact\Laravel\Runtime\InputTree;

/** A failed validation becomes the `schemaInvalid` refusal listing the contract's issues, found by the rules or mapped from Laravel's own. */
final class FormStepsTest extends TestCase
{
    private const NATIVE_RULE_NAMES = [
        'body.title' => ['Required' => 'required', 'Max' => 'maxLength'],
        'body.items.*.name' => ['Required' => 'required', 'Min' => 'minLength'],
        'body.items.*.tags.*' => ['Max' => 'maxLength'],
        'headers.x-trace' => ['Required' => 'required'],
        'query.limit' => ['Integer' => 'type'],
        'path.channelId' => ['Uuid' => 'format'],
    ];

    public function testAFailedRuleAtDepthIsMappedToItsPointerAndContractRuleName(): void
    {
        $issues = self::issues(['body.items.2.name' => ['Required' => []], 'body.items.0.tags.5' => ['Max' => []]]);

        self::assertSame([
            ['in' => 'body', 'pointer' => '/items/2/name', 'rule' => 'required'],
            ['in' => 'body', 'pointer' => '/items/0/tags/5', 'rule' => 'maxLength'],
        ], $issues);
    }

    public function testAWildcardStandsForOneSegmentOnly(): void
    {
        self::assertSame([], self::issues(['body.items.2.sub.name' => ['Required' => []]]));
        self::assertSame([], self::issues(['body.items.name' => ['Required' => []]]));
    }

    public function testALaravelRuleThatHasNoContractNameIsLeftOut(): void
    {
        self::assertSame([], self::issues(['body.title' => ['Alpha' => []]]));
    }

    public function testIssuesAreListedByPartThenInTheOrderFound(): void
    {
        $issues = self::issues([
            'body.title' => ['Required' => []],
            'headers.x-trace' => ['Required' => []],
            'query.limit' => ['Integer' => []],
            'path.channelId' => ['Uuid' => []],
            'body.items.1.name' => ['Min' => []],
        ]);

        self::assertSame(['path', 'query', 'header', 'body', 'body'], array_column($issues, 'in'));
        self::assertSame(['/title', '/items/1/name'], array_column(array_slice($issues, 3), 'pointer'));
    }

    public function testAHeaderIssueNamesTheHeaderInLowerCase(): void
    {
        self::assertSame([['in' => 'header', 'pointer' => '/x-trace', 'rule' => 'required']], self::issues(['headers.x-trace' => ['Required' => []]]));
    }

    public function testAnIssueFoundByARuleObjectAndByLaravelIsListedOnce(): void
    {
        $tree = self::tree();
        $tree->record('body.title', 'required');

        $issues = self::issues(['body.title' => ['Required' => []]], $tree);

        self::assertSame([['in' => 'body', 'pointer' => '/title', 'rule' => 'required']], $issues);
    }

    public function testTheRuleObjectsIssuesComeBeforeTheMappedOnesWithinAPart(): void
    {
        $tree = self::tree();
        $tree->record('body.items.1.name', 'format');

        $issues = self::issues(['body.title' => ['Required' => []]], $tree);

        self::assertSame(['/items/1/name', '/title'], array_column($issues, 'pointer'));
    }

    public function testAKeyWithADotOrASlashIsUnescapedInThePointer(): void
    {
        $tree = self::tree();
        $tree->record('body.' . InputTree::escape('a.b/c'), 'type');

        self::assertSame([['in' => 'body', 'pointer' => '/a.b~1c', 'rule' => 'type']], self::issues([], $tree));
    }

    public function testNoMoreThanTheCapIsRendered(): void
    {
        $tree = self::tree();
        for ($index = 0; $index < FormSteps::MAX_RENDERED_ISSUES + 25; ++$index) {
            $tree->record("body.items.{$index}.name", 'required');
        }

        $issues = self::issues([], $tree);

        self::assertCount(FormSteps::MAX_RENDERED_ISSUES, $issues);
        self::assertSame('/items/0/name', $issues[0]['pointer']);
    }

    /**
     * @param array<string, array<string, list<mixed>>> $failedByLaravel
     * @return list<array{in: string, pointer: string, rule: string}>
     */
    private static function issues(array $failedByLaravel, ?InputTree $tree = null): array
    {
        $request = Request::create('/v1/tasks', 'POST');
        $contract = ApiContract::of(FormStepsContract::class);
        $request->attributes->set(BoundaryState::attributeName('tasks'), new BoundaryState($contract, 'createTask', [], new RequestView('POST', '/v1/tasks', []), new class implements HookLookup {
            public function authenticateHook(ApiContract $contract, string $identity): never
            {
                throw new \LogicException('not called');
            }

            public function deciders(ApiContract $contract): iterable
            {
                return [];
            }

            public function scopeResolvers(ApiContract $contract): iterable
            {
                return [];
            }

            public function unexpectedErrorListener(ApiContract $contract): null
            {
                return null;
            }

            public function logger(): \Psr\Log\LoggerInterface
            {
                return new \Psr\Log\NullLogger();
            }

            public function isAccessDenial(\Throwable $failure): bool
            {
                return false;
            }

            public function isNotFoundDenial(\Throwable $failure): bool
            {
                return false;
            }
        }));
        $request->attributes->set(InputTree::attributeName('tasks'), $tree ?? self::tree());

        $validator = (new self('stub'))->createStub(Validator::class);
        $validator->method('failed')->willReturn($failedByLaravel);

        $refusal = FormSteps::failed($request, 'tasks', $validator, self::NATIVE_RULE_NAMES);

        self::assertSame('api.invalid', $refusal->contractCode);
        $body = json_decode(json_encode($refusal->params, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($body);
        /** @var list<array{in: string, pointer: string, rule: string}> $listed */
        $listed = $body['issues'];

        return $listed;
    }

    private static function tree(): InputTree
    {
        return InputTree::withBody([], [], [], (object) []);
    }
}
