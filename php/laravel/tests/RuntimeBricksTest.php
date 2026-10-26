<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\CacheHeaders;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\IdempotencyStep;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\PageReply;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/** The shared runtime's cross-target bricks on the reference contract: the fingerprint, the cache headers and page links, relative and absolute. */
final class RuntimeBricksTest extends TestCase
{
    private const PREFERENCES_BODY = '{"locale":"en","digest":false}';

    public function testTheFingerprintIgnoresTheIdempotencyKeyAndBindsTheBody(): void
    {
        $state = self::stateOf('createTask');
        $first = IdempotencyStep::fingerprint($state, ['headers' => (object) ['Idempotency-Key' => 'k1'], 'body' => (object) ['title' => 'a']]);

        self::assertSame($first, IdempotencyStep::fingerprint($state, ['headers' => (object) ['Idempotency-Key' => 'k2'], 'body' => (object) ['title' => 'a']]));
        self::assertNotSame($first, IdempotencyStep::fingerprint($state, ['headers' => (object) ['Idempotency-Key' => 'k1'], 'body' => (object) ['title' => 'b']]));
    }

    public function testACachedReadWritesItsCallerKindsCacheControlVaryAndStrongEtag(): void
    {
        $reply = CacheHeaders::written(Request::create('/v1/me/preferences'), self::identified('getPreferences'), new Response(self::PREFERENCES_BODY));

        self::assertSame(200, $reply->getStatusCode());
        self::assertTrue($reply->headers->hasCacheControlDirective('private'));
        self::assertSame('60', $reply->headers->getCacheControlDirective('max-age'));
        self::assertSame('Authorization, Cookie', $reply->headers->get('Vary'));
        self::assertSame('"' . rtrim(strtr(base64_encode(hash('sha256', self::PREFERENCES_BODY, true)), '+/', '-_'), '=') . '"', $reply->headers->get('ETag'));
    }

    public function testAWeakIfNoneMatchOfTheEtagIsA304WithoutBody(): void
    {
        $first = CacheHeaders::written(Request::create('/v1/me/preferences'), self::identified('getPreferences'), new Response(self::PREFERENCES_BODY));
        $request = Request::create('/v1/me/preferences', 'GET', [], [], [], ['HTTP_IF_NONE_MATCH' => 'W/' . $first->headers->get('ETag')]);

        $reply = CacheHeaders::written($request, self::identified('getPreferences'), new Response(self::PREFERENCES_BODY));

        self::assertSame(304, $reply->getStatusCode());
        self::assertSame('', $reply->getContent());
    }

    public function testAPageLinkEncodesItsCursorAndKeepsNoRawQueryDelimiter(): void
    {
        [, $headers] = PageReply::render(self::stateOf('listTasks'), 'limit=1&q=a>;rel="evil"', '/v1/channels/c/tasks', [], ['nextCursor' => 'c 2'], 200);
        $link = implode(',', array_map(strval(...), array_values($headers)));

        self::assertStringContainsString('cursor=c%202', $link);
        self::assertStringNotContainsString('a>', $link);
        self::assertStringNotContainsString('"evil"', $link);
    }

    public function testUnderAbsoluteUrlsAPageLinkStartsWithThePublicOriginAndThePath(): void
    {
        $state = self::stateOf('listTasks');
        $state->publicOrigin = 'https://api.example.com';
        [, $headers] = PageReply::render($state, 'limit=1', '/v1/channels/c/tasks', [], ['nextCursor' => 'c2'], 200);

        self::assertStringContainsString('<https://api.example.com/v1/channels/c/tasks?limit=1&cursor=c2>; rel="next"', implode(',', array_map(strval(...), array_values($headers))));
    }

    private static function identified(string $operationId): BoundaryState
    {
        $state = self::stateOf($operationId);
        $state->principal = new UserPrincipal('u1');

        return $state;
    }

    private static function stateOf(string $operationId): BoundaryState
    {
        return new BoundaryState(ApiContract::of(TasksContract::class), $operationId, [], new RequestView('GET', '/', []), new Hooks(new Container()));
    }
}
