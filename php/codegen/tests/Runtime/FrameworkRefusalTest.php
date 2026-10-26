<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\FrameworkRefusal;

/**
 * The one rule both PHP targets map a framework exception with: its role's code first, else the operation's single
 * code of its status that declares no required params, else none (the api's logged 500).
 */
final class FrameworkRefusalTest extends TestCase
{
    public function testTheRolesCodeComesFirst(): void
    {
        self::assertSame('api.not_found', FrameworkRefusal::codeOf(self::contract(), 'byRole', 'notFound', 404));
    }

    public function testWithoutTheRoleTheSingleCodeOfTheStatusAnswers(): void
    {
        self::assertSame('tasks.missing', FrameworkRefusal::codeOf(self::contract(), 'byStatus', 'notFound', 404));
        self::assertSame('tasks.teapot', FrameworkRefusal::codeOf(self::contract(), 'byStatus', null, 418));
    }

    public function testACodeWhoseParamsAreAllOptionalAnswers(): void
    {
        self::assertSame('tasks.hint', FrameworkRefusal::codeOf(self::contract(), 'byStatus', null, 422));
    }

    public function testTwoCodesOfTheStatusARequiredParamOrNoCodeAnswerNone(): void
    {
        self::assertNull(FrameworkRefusal::codeOf(self::contract(), 'ambiguous', null, 418));
        self::assertNull(FrameworkRefusal::codeOf(self::contract(), 'ambiguous', null, 409));
        self::assertNull(FrameworkRefusal::codeOf(self::contract(), 'ambiguous', 'notFound', 404));
        self::assertNull(FrameworkRefusal::codeOf(self::contract(), 'byStatus', null, null));
    }

    public function testAStatusTakesItsRole(): void
    {
        self::assertSame('notFound', FrameworkRefusal::roleOfStatus(404));
        self::assertSame('serviceUnavailable', FrameworkRefusal::roleOfStatus(503));
        self::assertNull(FrameworkRefusal::roleOfStatus(418));
    }

    private static function contract(): ApiContract
    {
        return ApiContract::of(StatusCodesContract::class);
    }
}
