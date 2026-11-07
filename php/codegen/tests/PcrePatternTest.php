<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\PcrePattern;

final class PcrePatternTest extends TestCase
{
    public function testAPatternTakesTheFirstDelimiterItDoesNotHold(): void
    {
        self::assertSame('/^[a-z]+$/uD', PcrePattern::of('^[a-z]+$', 'uD'));
        self::assertSame('#^a/b$#u', PcrePattern::of('^a/b$', 'u'));
    }

    public function testAPatternHoldingEveryDelimiterHasNoForm(): void
    {
        self::assertNull(PcrePattern::of(implode('', PcrePattern::DELIMITERS), 'u'));
    }
}
