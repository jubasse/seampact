<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\FrameworkRefusal;
use Symfony\Component\HttpFoundation\Response;

/**
 * The one rule both PHP targets map a framework exception with: its role's code first, else the operation's single
 * code of its status, either one answered with the params its role binding renders from the role's data (the delay a
 * `Retry-After` header gives), when they hold every required param; else none (the api's logged 500).
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

    public function testTheRetryDelayParamIsFilledByNameWithoutARetryHeader(): void
    {
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 2000]], self::answerOf('throttledWithoutRule', '2'));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 30000]], self::rateLimitedAnswerOf('limited', ['30']));
    }

    public function testAnOptionalRetryDelayParamIsFilledWhenTheDelayIsKnown(): void
    {
        self::assertEquals(['code' => 'tasks.patience', 'params' => (object) ['retryAfterMs' => 30000]], self::rateLimitedAnswerOf('patient', ['30']));
        self::assertEquals(['code' => 'tasks.patience', 'params' => null], self::rateLimitedAnswerOf('patient', []));
    }

    public function testAnAuthoredRoleTemplateRendersTheRetryDelay(): void
    {
        self::assertEquals(['code' => 'tasks.wait', 'params' => (object) ['waitMs' => 30000]], self::rateLimitedAnswerOf('waiting', ['30']));
        self::assertNull(self::rateLimitedAnswerOf('waiting', []));
    }

    public function testTheFirstUsableRetryAfterValueGivesTheDelay(): void
    {
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 30000]], self::rateLimitedAnswerOf('limited', ['soon', '30', '7']));
    }

    public function testALongDeltaSecondsValueIsCappedAtTheLargestSafeInteger(): void
    {
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 30000]], self::answerOf('throttled', '0000000000030'));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => self::MAX_SAFE_INTEGER]], self::answerOf('throttled', '99999999999999999999999'));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => self::MAX_SAFE_INTEGER]], self::answerOf('throttled', '9007199254741'));
    }

    public function testRfc850AndAsctimeDatesAreReadAsUtc(): void
    {
        $later = self::NOW + 45;
        $rfc850 = gmdate('l, d-M-y H:i:s \\G\\M\\T', $later);
        $singleDigitDay = gmmktime(8, 0, 0, 2, 1, 2027);
        $asctime = gmdate('D M ', $singleDigitDay) . str_pad(gmdate('j', $singleDigitDay), 2, ' ', STR_PAD_LEFT) . gmdate(' H:i:s Y', $singleDigitDay);

        self::assertSame('Mon Feb  1 08:00:00 2027', $asctime);
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => 45000]], self::answerOf('throttled', $rfc850));
        self::assertEquals(['code' => 'api.rate_limited', 'params' => (object) ['retryAfterMs' => ($singleDigitDay - self::NOW) * 1000]], self::answerOf('throttled', $asctime));
        self::assertNull(self::codeOf('throttled', 'rateLimited', 429, 'Mon Feb 31 08:00:00 2027'));
    }

    public function testACodeWithAnotherRequiredParamAnswersNoneWhateverTheRetryDelay(): void
    {
        self::assertNull(self::codeOf('quota', null, 429, '30'));
    }

    // The headers of an HTTP exception are read in each target's tests, which install symfony/http-kernel.
    public function testWithoutAnHttpExceptionTheRetryDelayIsReadFromTheResponse(): void
    {
        $response = new Response('', 429, ['Retry-After' => '7']);

        self::assertSame(['7'], FrameworkRefusal::retryAfterValuesOf(new \RuntimeException('throttled'), $response));
        self::assertSame(['7'], FrameworkRefusal::retryAfterValuesOf(null, $response));
        self::assertSame([], FrameworkRefusal::retryAfterValuesOf(null, new Response('', 429)));
    }

    public function testAStatusTakesItsRole(): void
    {
        self::assertSame('notFound', FrameworkRefusal::roleOfStatus(404));
        self::assertSame('serviceUnavailable', FrameworkRefusal::roleOfStatus(503));
        self::assertNull(FrameworkRefusal::roleOfStatus(418));
    }

    private const NOW = 1_800_000_000;
    private const HTTP_DATE = 'D, d M Y H:i:s \\G\\M\\T';
    private const MAX_SAFE_INTEGER = 9007199254740991;

    private static function codeOf(string $operationId, ?string $role, ?int $status, ?string $retryAfter = null): ?string
    {
        return FrameworkRefusal::answerOf(self::contract(), $operationId, $role, $status, $retryAfter === null ? [] : [$retryAfter], self::NOW)['code'] ?? null;
    }

    /** @return ?array{code: string, params: ?\stdClass} */
    private static function answerOf(string $operationId, string $retryAfter): ?array
    {
        return FrameworkRefusal::answerOf(self::contract(), $operationId, 'rateLimited', 429, [$retryAfter], self::NOW);
    }

    /**
     * @param list<string> $retryAfterValues
     * @return ?array{code: string, params: ?\stdClass}
     */
    private static function rateLimitedAnswerOf(string $operationId, array $retryAfterValues): ?array
    {
        return FrameworkRefusal::answerOf(ApiContract::of(RateLimitedContract::class), $operationId, 'rateLimited', 429, $retryAfterValues, self::NOW);
    }

    private static function contract(): ApiContract
    {
        return ApiContract::of(StatusCodesContract::class);
    }
}
