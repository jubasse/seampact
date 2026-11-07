<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\IdempotencyStep;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\StoredResponse;
use Symfony\Component\HttpFoundation\Response;

/** Idempotency at the boundary: the claim, the replay of a stored reply, what is stored, and a store that fails. */
final class IdempotencyStepTest extends TestCase
{
    private const CLIENT_KEY = 'key-1';

    public function testARequestWithoutAKeyClaimsNothing(): void
    {
        $store = new RecordingIdempotencyStore();

        self::assertNull(IdempotencyStep::begin(self::state($store), ['headers' => new \stdClass()]));
        self::assertSame([], $store->claims);
    }

    public function testANewKeyIsClaimedAndTheHandlerRuns(): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::state($store);

        self::assertNull(IdempotencyStep::begin($state, self::input()));
        self::assertSame(IdempotencyStep::partitionKey($state, self::CLIENT_KEY), $state->idempotencyKey);
        self::assertSame(60000, $store->claims[0]->lifetimeMs);
    }

    public function testARunningKeyRefusesWithTheInProgressCode(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->answer = new IdempotencyBegin\Running();

        self::assertSame('api.in_progress', self::refusal($store)->contractCode);
    }

    public function testAKeyUsedWithAnotherRequestRefusesWithTheKeyReusedCode(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->answer = new IdempotencyBegin\Mismatch();

        self::assertSame('api.key_reused', self::refusal($store)->contractCode);
    }

    public function testAReplayedSuccessKeepsItsStatusBodyAndHeadersAndAddsTheReplayHeader(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->answer = new IdempotencyBegin\Replay(new StoredResponse(201, [
            new StoredResponse\Header('content-type', 'application/json'),
            new StoredResponse\Header('location', '/v1/tasks/1'),
        ], '{"id":"1"}'));
        $state = self::state($store);

        $reply = IdempotencyStep::begin($state, self::input());

        self::assertNotNull($reply);
        self::assertSame(201, $reply->getStatusCode());
        self::assertSame('{"id":"1"}', $reply->getContent());
        self::assertSame('/v1/tasks/1', $reply->headers->get('Location'));
        self::assertSame('true', $reply->headers->get('Idempotent-Replayed'));
        self::assertTrue($state->authored($reply), 'The replay is a reply the boundary wrote.');
        self::assertNull($state->idempotencyKey, 'A replay claims nothing to settle.');
    }

    public function testAReplayDoesNotCopyAStoredReplayHeaderTwice(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->answer = new IdempotencyBegin\Replay(new StoredResponse(201, [new StoredResponse\Header('idempotent-replayed', 'stale')], '{}'));

        $reply = IdempotencyStep::begin(self::state($store), self::input());

        self::assertNotNull($reply);
        self::assertSame(['true'], $reply->headers->all('Idempotent-Replayed'));
    }

    public function testAReplayedErrorGetsNoReplayHeader(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->answer = new IdempotencyBegin\Replay(new StoredResponse(422, [new StoredResponse\Header('content-type', 'application/problem+json')], '{"code":"x"}'));

        $reply = IdempotencyStep::begin(self::state($store), self::input());

        self::assertNotNull($reply);
        self::assertSame(422, $reply->getStatusCode());
        self::assertFalse($reply->headers->has('Idempotent-Replayed'));
    }

    public function testASuccessIsStoredWithItsContentAndDeclaredHeadersOnly(): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::claimed($store);
        $response = new Response('{"id":"1"}', 201, [
            'Content-Type' => 'application/json',
            'Content-Language' => 'en',
            'Location' => '/v1/tasks/1',
            'Set-Cookie' => 'session=secret',
            'X-Request-Id' => 'r-1',
        ]);

        IdempotencyStep::settle($state, $response);

        $stored = $store->completed[IdempotencyStep::partitionKey($state, self::CLIENT_KEY)];
        $names = array_map(static fn (StoredResponse\Header $header): string => $header->name, $stored->headers);
        sort($names);
        self::assertSame(201, $stored->status);
        self::assertSame('{"id":"1"}', $stored->body);
        self::assertSame(['content-language', 'content-type', 'location'], $names);
        self::assertNull($state->idempotencyKey);
    }

    /** @return iterable<string, array{Response}> */
    public static function repliesThatReleaseTheKey(): iterable
    {
        yield 'a server error' => [new Response('{}', 500)];
        yield 'a bad gateway' => [new Response('{}', 502)];
        yield 'a client error that forbids storing' => [new Response('{}', 429, ['Cache-Control' => 'no-store'])];
    }

    #[DataProvider('repliesThatReleaseTheKey')]
    public function testAReplyThatMustNotBeKeptReleasesTheKeyInsteadOfStoringIt(Response $response): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::claimed($store);
        $key = (string) $state->idempotencyKey;

        IdempotencyStep::settle($state, $response);

        self::assertSame([], $store->completed);
        self::assertSame([$key], $store->abandoned);
    }

    public function testAClientErrorWithoutNoStoreIsKeptForReplay(): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::claimed($store);

        IdempotencyStep::settle($state, new Response('{"code":"x"}', 422));

        self::assertCount(1, $store->completed);
        self::assertSame([], $store->abandoned);
    }

    public function testANoStoreSuccessIsKeptSoARetryNeverRunsTheWriteTwice(): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::claimed($store);

        IdempotencyStep::settle($state, new Response('{}', 201, ['Cache-Control' => 'no-store']));

        self::assertCount(1, $store->completed);
    }

    public function testASettleWithoutAClaimTouchesNoStore(): void
    {
        $store = new RecordingIdempotencyStore();

        IdempotencyStep::settle(self::state($store), new Response('{}', 201));

        self::assertSame([], $store->completed);
        self::assertSame([], $store->abandoned);
    }

    public function testAStoreThatFailsToCompleteIsLoggedAndTheReplyStillGoesOut(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->failOnComplete = true;
        $hooks = ScriptedHooks::none($store);
        $state = self::claimed($store, $hooks);

        IdempotencyStep::settle($state, new Response('{}', 201));

        self::assertNull($state->idempotencyKey);
        self::assertCount(1, $hooks->logged);
        self::assertStringContainsString('failed to record the reply', $hooks->logged[0]);
        self::assertStringContainsString('RuntimeException', $hooks->logged[0]);
    }

    public function testAStoreThatFailsToAbandonOnASettleIsLoggedToo(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->failOnAbandon = true;
        $hooks = ScriptedHooks::none($store);

        IdempotencyStep::settle(self::claimed($store, $hooks), new Response('{}', 500));

        self::assertCount(1, $hooks->logged);
        self::assertStringContainsString('failed to record the reply', $hooks->logged[0]);
    }

    public function testAbandonReleasesTheClaimedKeyOnce(): void
    {
        $store = new RecordingIdempotencyStore();
        $state = self::claimed($store);
        $key = (string) $state->idempotencyKey;

        IdempotencyStep::abandon($state);
        IdempotencyStep::abandon($state);

        self::assertSame([$key], $store->abandoned);
    }

    public function testAnAbandonThatFailsIsLogged(): void
    {
        $store = new RecordingIdempotencyStore();
        $store->failOnAbandon = true;
        $hooks = ScriptedHooks::none($store);

        IdempotencyStep::abandon(self::claimed($store, $hooks));

        self::assertCount(1, $hooks->logged);
        self::assertStringContainsString('failed to release a key', $hooks->logged[0]);
    }

    public function testAMissingStoreIsALogicErrorNamingTheFix(): void
    {
        $state = new BoundaryState(ApiContract::of(IdempotentContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), ScriptedHooks::none());

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('has no idempotency store');
        IdempotencyStep::begin($state, self::input());
    }

    public function testTheFingerprintIgnoresTheKeyHeaderAndTheCaseOfHeaderNames(): void
    {
        $state = self::state(new RecordingIdempotencyStore());

        $first = IdempotencyStep::fingerprint($state, ['headers' => (object) ['idempotency-key' => 'a', 'X-Tenant' => 't']]);
        $retry = IdempotencyStep::fingerprint($state, ['headers' => (object) ['idempotency-key' => 'b', 'x-tenant' => 't']]);

        self::assertSame($first, $retry);
    }

    public function testTheFingerprintChangesWithADeclaredHeaderOrTheBody(): void
    {
        $state = self::state(new RecordingIdempotencyStore());
        $base = IdempotencyStep::fingerprint($state, ['headers' => (object) ['x-tenant' => 't'], 'body' => (object) ['title' => 'a']]);

        self::assertNotSame($base, IdempotencyStep::fingerprint($state, ['headers' => (object) ['x-tenant' => 'u'], 'body' => (object) ['title' => 'a']]));
        self::assertNotSame($base, IdempotencyStep::fingerprint($state, ['headers' => (object) ['x-tenant' => 't'], 'body' => (object) ['title' => 'b']]));
    }

    public function testTheKeyIsPartitionedByThePrincipal(): void
    {
        $alice = self::state(new RecordingIdempotencyStore());
        $alice->principalMembers = ['id' => 'alice'];
        $bob = self::state(new RecordingIdempotencyStore());
        $bob->principalMembers = ['id' => 'bob'];

        self::assertNotSame(IdempotencyStep::partitionKey($alice, self::CLIENT_KEY), IdempotencyStep::partitionKey($bob, self::CLIENT_KEY));
    }

    /** @return array{headers: \stdClass} */
    private static function input(): array
    {
        return ['headers' => (object) ['idempotency-key' => self::CLIENT_KEY, 'x-tenant' => 't']];
    }

    private static function refusal(RecordingIdempotencyStore $store): ContractRefusal
    {
        try {
            IdempotencyStep::begin(self::state($store), self::input());
        } catch (ContractRefusal $refusal) {
            return $refusal;
        }

        self::fail('The step let the request through.');
    }

    private static function claimed(RecordingIdempotencyStore $store, ?ScriptedHooks $hooks = null): BoundaryState
    {
        $state = self::state($store, $hooks);
        IdempotencyStep::begin($state, self::input());

        return $state;
    }

    private static function state(RecordingIdempotencyStore $store, ?ScriptedHooks $hooks = null): BoundaryState
    {
        return new BoundaryState(ApiContract::of(IdempotentContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), $hooks ?? ScriptedHooks::none($store));
    }
}
