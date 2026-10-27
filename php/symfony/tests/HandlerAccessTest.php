<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\TypedInput;
use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Seampact\Symfony\Runtime\Hooks;
use Symfony\Component\DependencyInjection\ServiceLocator;

/** The input a handler receives carries who is calling beside its wire parts: the principal and the scopes. */
final class HandlerAccessTest extends TestCase
{
    private const CHANNEL_ID = '0b9a7d1e-5c1f-4d8e-9a33-2f1c6b8e4d10';

    public function testTheInputCarriesThePrincipalInTheGeneratedClassAndTheScopes(): void
    {
        $channel = new \stdClass();
        $state = self::admittedState(new CustomPrincipal('alice'), $channel);

        $input = TypedInput::build($state, ['path' => (object) ['channelId' => self::CHANNEL_ID]]);

        self::assertInstanceOf(GetChannelInput::class, $input);
        self::assertEquals(new UserPrincipal('alice'), $input->principal());
        self::assertSame(self::CHANNEL_ID, $input->scopes()->channel()->id);
        self::assertSame($channel, $input->scopes()->channel()->value);
        self::assertSame(self::CHANNEL_ID, $input->path->channelId);
    }

    public function testAScopeTheBoundaryDidNotResolveFailsLoud(): void
    {
        $state = self::admittedState(new UserPrincipal('alice'), null);
        $state->scopes = [];

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('runs in the scopes channel, but the boundary resolved none');
        TypedInput::build($state, ['path' => (object) ['channelId' => self::CHANNEL_ID]]);
    }

    public function testJsonEncodingTheInputShowsNeitherThePrincipalNorTheScopes(): void
    {
        $state = self::admittedState(new UserPrincipal('alice-secret-id'), (object) ['name' => 'channel-secret']);

        $encoded = json_encode(TypedInput::build($state, ['path' => (object) ['channelId' => self::CHANNEL_ID]]), JSON_THROW_ON_ERROR);

        self::assertStringContainsString(self::CHANNEL_ID, $encoded);
        self::assertStringNotContainsString('alice-secret-id', $encoded);
        self::assertStringNotContainsString('channel-secret', $encoded);
    }

    private static function admittedState(object $principal, ?object $channel): BoundaryState
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger());
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'getChannel', ['channelId' => self::CHANNEL_ID], new RequestView('GET', '/v1/channels/' . self::CHANNEL_ID, []), $hooks);
        $state->principal = $principal;
        $state->scopes = [new ResolvedScope('channel', self::CHANNEL_ID, $channel)];
        $state->admitted = true;

        return $state;
    }
}
