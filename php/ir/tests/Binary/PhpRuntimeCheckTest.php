<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\PhpRuntimeCheck;

/** A PHP release without the October 2026 fixes is refused, unless the root package says it is patched. */
final class PhpRuntimeCheckTest extends TestCase
{
    /** @return array<string, array{string, ?string}> the version, and the fixed release named, or null when it passes */
    public static function versions(): array
    {
        return [
            '8.2 below the floor' => ['8.2.29', '8.3.36'],
            '8.3 unpatched' => ['8.3.35', '8.3.36'],
            '8.3 fixed' => ['8.3.36', null],
            '8.4 unpatched' => ['8.4.26', '8.4.27'],
            '8.4 later' => ['8.4.30', null],
            '8.5 unpatched' => ['8.5.4', '8.5.12'],
            '8.5 fixed with a suffix' => ['8.5.12-1+ubuntu24.04.1', null],
            'a later branch' => ['8.6.0', null],
        ];
    }

    #[DataProvider('versions')]
    public function testRefusesAnUnpatchedReleaseNamingTheFixedOne(string $version, ?string $fixed): void
    {
        if ($fixed === null) {
            PhpRuntimeCheck::check($version, false);
            $this->addToAssertionCount(1);

            return;
        }

        try {
            PhpRuntimeCheck::check($version, false);
            self::fail("PHP {$version} is unpatched.");
        } catch (BinaryRefusedException $refused) {
            self::assertSame(BinaryFailureCode::PhpUnpatched, $refused->failure->code);
            self::assertStringContainsString($version, $refused->failure->message);
            self::assertStringContainsString($fixed, $refused->failure->message);
            self::assertStringContainsString('phpPatched', $refused->failure->fix);
        }
    }

    public function testLetsABackportPassWithThePhpPatchedOptOut(): void
    {
        PhpRuntimeCheck::check('8.3.6', true);
        $this->addToAssertionCount(1);
    }
}
