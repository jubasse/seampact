<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Tests\Support\AccessContract;
use Seampact\Codegen\Tests\Support\AccessCredentials;
use Seampact\Codegen\Tests\Support\AccessPrincipal;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\ScopeResolution;
use Symfony\Component\HttpFoundation\Request;

/**
 * The access steps (2 to 5): a hook that throws never admits the request, the credentials are read as the scheme
 * says, and a path value is checked by its type before a hook sees it.
 */
final class AccessStepsTest extends TestCase
{
    public function testAThrowingAuthenticateHookLeavesTheRequestUnadmittedAndRaisesTheFailure(): void
    {
        $state = self::state(self::hooks(authenticate: static fn () => throw new \RuntimeException('auth backend down')));

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('auth backend down');
        try {
            AccessSteps::run(self::bearerRequest('token'), $state);
        } finally {
            self::assertNull($state->principal);
            self::assertFalse($state->admitted);
        }
    }

    public function testAThrowingScopeResolverRaisesTheFailureAndResolvesNoScope(): void
    {
        $state = self::state(self::hooks(resolveScope: static fn () => throw new \RuntimeException('scope backend down')));

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('scope backend down');
        try {
            AccessSteps::run(self::bearerRequest('token'), $state);
        } finally {
            self::assertSame([], $state->scopes);
            self::assertFalse($state->admitted);
        }
    }

    public function testAThrowingDeciderThatIsNotAnAccessDenialRaisesTheFailureInsteadOfAllowing(): void
    {
        $state = self::state(self::hooks(decide: static fn () => throw new \RuntimeException('policy backend down')));

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('policy backend down');
        AccessSteps::run(self::bearerRequest('token'), $state);
    }

    public function testADeciderThrowingTheFrameworksDenialRefusesWithTheRulesFirstCode(): void
    {
        $state = self::state(self::hooks(decide: static fn () => throw new \DomainException('denied')));

        self::assertSame('tasks.not_owner', self::refusal($state, self::bearerRequest('token'))->contractCode);
    }

    public function testAnAllowingDeciderRunsAfterAuthenticateAndScopes(): void
    {
        $state = self::state(self::hooks());

        AccessSteps::run(self::bearerRequest('token'), $state);

        self::assertNotNull($state->principal);
        self::assertSame(['user-1'], array_values($state->principalMembers ?? []));
        self::assertSame(['channel'], array_map(static fn (ResolvedScope $scope): string => $scope->scope, $state->scopes));
        self::assertSame(7, $state->scopes[0]->id);
    }

    public function testAHookDenyingWithACodeTheOperationDoesNotDeclareIsALogicError(): void
    {
        $state = self::state(self::hooks(decide: static fn () => new Decision\Denied(new \Seampact\Codegen\Runtime\Denial('tasks.undeclared'))));

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('tasks.undeclared');
        AccessSteps::run(self::bearerRequest('token'), $state);
    }

    public function testAScopeResolverAnsweringAnotherScopeIsALogicError(): void
    {
        $state = self::state(self::hooks(resolveScope: static fn () => new ScopeResolution\Resolved(new ResolvedScope('workspace', 1))));

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("answered the scope 'workspace'");
        AccessSteps::run(self::bearerRequest('token'), $state);
    }

    /** @return iterable<string, array{array<string, string>}> */
    public static function unusableAuthorizationHeaders(): iterable
    {
        yield 'no header' => [[]];
        yield 'bearer without a token' => [['Authorization' => 'Bearer']];
        yield 'bearer with a blank token' => [['Authorization' => 'Bearer    ']];
        yield 'another scheme' => [['Authorization' => 'Basic dXNlcjpwYXNz']];
        yield 'a token glued to the word' => [['Authorization' => 'Bearertoken']];
        yield 'an empty header' => [['Authorization' => '']];
    }

    /** @param array<string, string> $headers */
    #[DataProvider('unusableAuthorizationHeaders')]
    public function testAnAuthorizationHeaderWithoutABearerTokenIsNoCredential(array $headers): void
    {
        $request = Request::create('/v1/channels/7/tasks/1');
        $request->headers->add($headers);

        self::assertSame('api.unauthenticated', self::refusal(self::state(self::hooks()), $request)->contractCode);
    }

    public function testTheBearerPrefixIsReadWhateverItsCaseAndTheTokenIsTrimmed(): void
    {
        $seen = null;
        $state = self::state(self::hooks(authenticate: static function (AuthenticateCall $request) use (&$seen): AuthenticateResult {
            $credentials = $request->credentials();
            self::assertInstanceOf(AccessCredentials::class, $credentials);
            $seen = $credentials->token;

            return new AuthenticateResult\Authenticated(new class implements AccessPrincipal {
                public function userId(): string
                {
                    return 'u';
                }
            });
        }));

        AccessSteps::run(self::requestWith(['Authorization' => 'BEARER   abc  ']), $state);

        self::assertSame('abc', $seen);
    }

    public function testASessionCookieIsFoundByNameAmongTheOthers(): void
    {
        $seen = null;
        $state = self::state(self::hooks(authenticate: static function (AuthenticateCall $request) use (&$seen): AuthenticateResult {
            $credentials = $request->credentials();
            self::assertInstanceOf(AccessCredentials::class, $credentials);
            $seen = $credentials->cookie;

            return new AuthenticateResult\Authenticated(new class implements AccessPrincipal {
                public function userId(): string
                {
                    return 'u';
                }
            });
        }));

        AccessSteps::run(self::requestWith(['Cookie' => 'theme=dark; sid=abc=; other=1', 'X-Csrf-Token' => 'csrf']), $state);

        self::assertSame('abc=', $seen);
    }

    public function testACookieNamedLikeTheSessionButLongerIsNotTheSession(): void
    {
        $state = self::state(self::hooks());

        self::assertSame('api.unauthenticated', self::refusal($state, self::requestWith(['Cookie' => 'sidebar=1; xsid=2']))->contractCode);
    }

    public function testACookieCredentialWithoutTheCsrfHeaderIsRefused(): void
    {
        $state = self::state(self::hooks());

        self::assertSame('api.csrf_invalid', self::refusal($state, self::requestWith(['Cookie' => 'sid=abc']))->contractCode);
    }

    public function testACookieCredentialWithAnEmptyCsrfHeaderIsRefused(): void
    {
        $state = self::state(self::hooks());

        self::assertSame('api.csrf_invalid', self::refusal($state, self::requestWith(['Cookie' => 'sid=abc', 'X-Csrf-Token' => '']))->contractCode);
    }

    public function testABearerTokenBesideTheCookieNeedsNoCsrfHeader(): void
    {
        $state = self::state(self::hooks());

        AccessSteps::run(self::requestWith(['Cookie' => 'sid=abc', 'Authorization' => 'Bearer t']), $state);

        self::assertNotNull($state->principal);
    }

    public function testAnOptionalOperationWithoutCredentialsRunsAnonymously(): void
    {
        $state = self::state(self::hooks(), 'listPublic');

        AccessSteps::run(Request::create('/v1/public'), $state);

        self::assertNull($state->principal);
    }

    public function testAnOptionalOperationWhoseCredentialsAreDeniedFallsBackToAnonymous(): void
    {
        $state = self::state(self::hooks(authenticate: static fn () => new AuthenticateResult\Denied(new \Seampact\Codegen\Runtime\Denial('api.unauthenticated'))), 'listPublic');

        AccessSteps::run(self::bearerRequest('bad'), $state);

        self::assertNull($state->principal);
    }

    public function testARequiredOperationWhoseCredentialsAreDeniedRefusesWithTheHooksCode(): void
    {
        $state = self::state(self::hooks(authenticate: static fn () => new AuthenticateResult\Denied(new \Seampact\Codegen\Runtime\Denial('api.unauthenticated'))));

        self::assertSame('api.unauthenticated', self::refusal($state, self::bearerRequest('bad'))->contractCode);
    }

    public function testAScopeIdThatIsNotAnIntegerIsRefusedBeforeAnyHookRuns(): void
    {
        $hookRan = false;
        $state = self::state(self::hooks(resolveScope: static function () use (&$hookRan): never {
            $hookRan = true;

            throw new \LogicException('must not run');
        }), 'getTask', ['channelId' => 'abc']);

        $refusal = self::refusal($state, self::bearerRequest('token'));

        self::assertSame('api.invalid', $refusal->contractCode);
        self::assertFalse($hookRan);
    }

    private static function bearerRequest(string $token): Request
    {
        return self::requestWith(['Authorization' => "Bearer {$token}"]);
    }

    /** @param array<string, string> $headers */
    private static function requestWith(array $headers): Request
    {
        $request = Request::create('/v1/channels/7/tasks/1');
        $request->headers->add($headers);

        return $request;
    }

    private static function refusal(BoundaryState $state, Request $request): ContractRefusal
    {
        try {
            AccessSteps::run($request, $state);
        } catch (ContractRefusal $refusal) {
            return $refusal;
        }

        self::fail('The access steps admitted the request.');
    }

    /** @param array<string, string> $rawParameters */
    private static function state(ScriptedHooks $hooks, string $operationId = 'getTask', array $rawParameters = ['channelId' => '7']): BoundaryState
    {
        return new BoundaryState(ApiContract::of(AccessContract::class), $operationId, $rawParameters, new RequestView('GET', '/v1/channels/7/tasks/1', []), $hooks);
    }

    private static function hooks(?\Closure $authenticate = null, ?\Closure $resolveScope = null, ?\Closure $decide = null): ScriptedHooks
    {
        return new ScriptedHooks(
            $authenticate ?? static fn (): AuthenticateResult => new AuthenticateResult\Authenticated(new class implements AccessPrincipal {
                public function userId(): string
                {
                    return 'user-1';
                }
            }),
            $resolveScope ?? static fn (): ScopeResolution => new ScopeResolution\Resolved(new ResolvedScope('channel', 7)),
            $decide ?? static fn (): Decision => new Decision\Allowed(),
        );
    }
}
