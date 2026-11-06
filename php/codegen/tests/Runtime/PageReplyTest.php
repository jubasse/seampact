<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\PageReply;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\RequestView;

/** The page counts and links the boundary writes, as the Node and Spring targets write them. */
final class PageReplyTest extends TestCase
{
    public function testAnEmptyListCountsNoPageAndItsLastLinkIsTheFirstPage(): void
    {
        $state = new BoundaryState(ApiContract::of(PagesContract::class), 'listChannels', [], new RequestView('GET', '/v1/channels', []), self::lookup());

        [$body] = PageReply::render($state, 'per_page=2', '/v1/channels', [], ['total' => 0], 200);

        self::assertEquals((object) ['lastPage' => 0, 'first' => '?per_page=2&page=1', 'last' => '?per_page=2&page=1'], $body);
    }

    public function testARawPathCannotAddALinkRelation(): void
    {
        $state = new BoundaryState(ApiContract::of(PagesContract::class), 'listChannels', [], new RequestView('GET', '/v1/channels', []), self::lookup());
        $state->publicOrigin = 'https://api.example.com';

        [$body] = PageReply::render($state, 'per_page=2', '/v1/a>;rel="evil",<b', [], ['total' => 0], 200);

        $first = 'https://api.example.com/v1/a%3E%3Brel%3D%22evil%22%2C%3Cb?per_page=2&page=1';
        self::assertEquals((object) ['lastPage' => 0, 'first' => $first, 'last' => $first], $body);
    }

    public function testBothStripeCursorsAreOneExclusiveCursorsIssueAtTheBeforeParameter(): void
    {
        $state = self::stateOf('listCharges');

        $issues = PageReply::cursorIssues($state, (object) ['starting_after' => 'ch_1', 'ending_before' => 'ch_9']);

        self::assertSame([['in' => 'query', 'pointer' => '/ending_before', 'rule' => 'exclusiveCursors']], $issues);
    }

    public function testOneStripeCursorOrAStyleWithoutThePairHasNoCursorIssue(): void
    {
        self::assertSame([], PageReply::cursorIssues(self::stateOf('listCharges'), (object) ['starting_after' => 'ch_1']));
        self::assertSame([], PageReply::cursorIssues(self::stateOf('listCharges'), (object) ['ending_before' => 'ch_9']));
        self::assertSame([], PageReply::cursorIssues(self::stateOf('listChannels'), (object) ['page' => 2]));
    }

    private static function stateOf(string $operationId): BoundaryState
    {
        return new BoundaryState(ApiContract::of(PagesContract::class), $operationId, [], new RequestView('GET', '/v1/list', []), self::lookup());
    }

    private static function lookup(): HookLookup
    {
        return new class () implements HookLookup {
            public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
            {
                throw new \LogicException('not called by a page reply');
            }

            public function deciders(ApiContract $contract): iterable
            {
                return [];
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
