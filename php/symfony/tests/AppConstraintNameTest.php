<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Symfony\Runtime\AppConstraintName;
use Seampact\Symfony\Runtime\Rule;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintViolation;
use Symfony\Component\Validator\Constraints\NotBlank;

/** The name an app constraint gives its violation: payload, then code, then the custom class name. */
final class AppConstraintNameTest extends TestCase
{
    private const UUID_CODE = '0d0cbc66-d8ef-4a3a-a2b9-8c9e2a6f6d65';

    public function testThePayloadRuleWins(): void
    {
        $violation = self::violation(new NotBlank(payload: Rule::payload('filled')), 'fromCode');

        self::assertSame('filled', AppConstraintName::of($violation));
    }

    public function testACodeTheRuleSetIsTheName(): void
    {
        self::assertSame('fromCode', AppConstraintName::of(self::violation(new NotBlank(), 'fromCode')));
    }

    public function testSymfonysOwnUuidCodeIsNotAName(): void
    {
        self::assertNull(AppConstraintName::of(self::violation(new NotBlank(), self::UUID_CODE)));
    }

    public function testACustomConstraintGivesItsShortClassNameFirstLetterLowered(): void
    {
        self::assertSame('endAfterStartRule', AppConstraintName::of(self::violation(new EndAfterStartRule(), null)));
    }

    public function testAnAnonymousConstraintHasNoName(): void
    {
        self::assertNull(AppConstraintName::of(self::violation(new class () extends Constraint {
        }, null)));
    }

    public function testAViolationWithoutAConstraintHasNoName(): void
    {
        self::assertNull(AppConstraintName::of(self::violation(null, null)));
    }

    private static function violation(?Constraint $constraint, ?string $code): ConstraintViolation
    {
        return new ConstraintViolation('message', null, [], null, 'path', null, null, $code, $constraint);
    }
}

/** A custom constraint of the app. */
final class EndAfterStartRule extends Constraint
{
}
