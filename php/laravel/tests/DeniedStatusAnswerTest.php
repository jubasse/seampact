<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Access\AuthorizationException;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\FrameworkRefusal;
use Seampact\Laravel\Runtime\ExceptionRoles;

/**
 * An authorization denial given a status outside a decider (the `can` middleware, `Gate::authorize()`): it answers the
 * code of that status when the operation declares one, else the operation's forbidden code.
 */
final class DeniedStatusAnswerTest extends TestCase
{
    public function testADenialHiddenAsNotFoundAnswersTheNotFoundCodeTheOperationDeclares(): void
    {
        self::assertSame('api.not_found', self::answeredCode('getTask', (new AuthorizationException())->asNotFound()));
    }

    public function testADenialHiddenAsNotFoundAnswersForbiddenWhenTheOperationHasNoNotFoundCode(): void
    {
        self::assertSame('api.forbidden', self::answeredCode('archiveTasks', (new AuthorizationException())->asNotFound()));
    }

    public function testADenialWithStatus401AnswersForbiddenWhenTheOperationHasNoUnauthenticatedCode(): void
    {
        self::assertSame('api.forbidden', self::answeredCode('getTask', (new AuthorizationException())->withStatus(401)));
    }

    public function testAPlainDenialAnswersForbidden(): void
    {
        self::assertSame('api.forbidden', self::answeredCode('getTask', new AuthorizationException()));
    }

    private static function answeredCode(string $operationId, AuthorizationException $denial): ?string
    {
        $contract = ApiContract::of(DeniedStatusContract::class);
        $role = ExceptionRoles::roleIn($contract, $operationId, $denial);

        return FrameworkRefusal::answerOf($contract, $operationId, $role, FrameworkRefusal::statusOf($denial), [], time())['code'] ?? null;
    }
}
