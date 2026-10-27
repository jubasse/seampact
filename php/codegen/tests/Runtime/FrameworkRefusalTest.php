<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\FrameworkRefusal;
use Symfony\Component\HttpFoundation\Response;

/**
 * The one rule both PHP targets map a framework exception with: its role's code first, else the operation's single
 * code of its status, either one answered only when it declares no required params or when its one required param is
 * the delay a `Retry-After` header gives; else none (the api's logged 500).
 */
final class FrameworkRefusalTest extends TestCase
{
    public function testTheRolesCodeComesFirst(): void
    {
        self::assertSame('api.not_found', self::codeOf('byRole', 'notFound', 404));
    }

    public function testWithoutTheRoleTheSingleCodeOfTheStatusAnswers(): void
    {
        self::assertSame('tasks.missing', self::codeOf('byStatus', 'notFound', 404));
        self::assertSame('tasks.teapot', self::codeOf('byStatus', null, 418));
    }

    public function testARoleWithoutAStatusTakesTheStatusOfItsRole(): void
    {
        self::assertSame('tasks.missing', self::codeOf('byStatus', 'notFound', null));
    }

    public function testACodeWhoseParamsAreAllOptionalOrDefaultedAnswers(): void
    {
        self::assertSame('tasks.hint', self::codeOf('byStatus', null, 422));
        self::assertSame('tasks.stale', self::codeOf('byStatus', null, 409));
    }

    public function testTwoCodesOfTheStatusARequiredParamOrNoCodeAnswerNone(): void
    {
        self::assertNull(self::codeOf('ambiguous', null, 418));
        self::assertNull(self::codeOf('ambiguous', null, 409));
        self::assertNull(self::codeOf('ambiguous', 'notFound', 404));
        self::assertNull(self::codeOf('byStatus', null, null));
    }

    public function testARoleCodeWithARequiredParamAnswersNoneWithoutARetryDelay(): void
    {
        self::assertNull(self::codeOf('throttled', 'rateLimited', 429));
        self::assertNull(self::codeOf('throttled', 'rateLimited', 429, 'soon'));
        self::assertNull(self::codeOf('throttled', 'rateLimited', 429, '-5'));
    }

    public function testTheRetryDelayParamIsFilledFromDeltaSecondsOrAnHttpDate(): void
    {
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 30000]], self::answerOf('throttled', '30'));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 45000]], self::answerOf('throttled', gmdate(self::HTTP_DATE, self::NOW + 45)));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 0]], self::answerOf('throttled', gmdate(self::HTTP_DATE, self::NOW - 10)));
    }

    public function testTheRetryDelayParamIsKnownFromAnotherOperationsRetryHeader(): void
    {
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 2000]], self::answerOf('throttledWithoutRule', '2'));
    }

    public function testACodeWithAnotherRequiredParamAnswersNoneWhateverTheRetryDelay(): void
    {
        self::assertNull(self::codeOf('quota', null, 429, '30'));
    }

    // The headers of an HTTP exception are read in each target's tests, which install symfony/http-kernel.
    public function testWithoutAnHttpExceptionTheRetryDelayIsReadFromTheResponse(): void
    {
        $response = new Response('', 429, ['Retry-After' => '7']);

        self::assertSame('7', FrameworkRefusal::retryAfterOf(new \RuntimeException('throttled'), $response));
        self::assertSame('7', FrameworkRefusal::retryAfterOf(null, $response));
        self::assertNull(FrameworkRefusal::retryAfterOf(null, new Response('', 429)));
    }

    public function testAStatusTakesItsRole(): void
    {
        self::assertSame('notFound', FrameworkRefusal::roleOfStatus(404));
        self::assertSame('serviceUnavailable', FrameworkRefusal::roleOfStatus(503));
        self::assertNull(FrameworkRefusal::roleOfStatus(418));
    }

    private const NOW = 1_800_000_000;
    private const HTTP_DATE = 'D, d M Y H:i:s \\G\\M\\T';

    private static function codeOf(string $operationId, ?string $role, ?int $status, ?string $retryAfter = null): ?string
    {
        return FrameworkRefusal::answerOf(self::contract(), $operationId, $role, $status, $retryAfter, self::NOW)['code'] ?? null;
    }

    /** @return ?array{code: string, params: ?\stdClass} */
    private static function answerOf(string $operationId, string $retryAfter): ?array
    {
        return FrameworkRefusal::answerOf(self::contract(), $operationId, 'rateLimited', 429, $retryAfter, self::NOW);
    }

    private static function contract(): ApiContract
    {
        return ApiContract::of(StatusCodesContract::class);
    }
}
