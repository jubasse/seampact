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

            public function isNotFoundDenial(\Throwable $failure): bool
            {
                return false;
            }
        };
    }
}
