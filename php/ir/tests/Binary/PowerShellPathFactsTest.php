<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\PowerShellPathFacts;
use Seampact\Ir\Binary\WindowsPathFact;

/** The JSON the Windows ACL reader prints: read when it has the script's shape, refused otherwise (fail closed). */
final class PowerShellPathFactsTest extends TestCase
{
    private const COPY = 'C:\\Users\\dev\\AppData\\Local\\seampact\\abc\\seampact.exe';

    public function testReadsTheFactsOfEachPath(): void
    {
        $read = self::decoded('{"user":"S-1-5-21-1","facts":[{"path":' . json_encode(self::COPY) . ',"reparse":false,"writers":["S-1-5-21-1","S-1-5-18"]}]}');

        self::assertEquals([self::COPY => new WindowsPathFact(false, ['S-1-5-21-1', 'S-1-5-18'])], PowerShellPathFacts::factsOf($read));
    }

    /** @return array<string, array{string}> */
    public static function unexpectedOutputs(): array
    {
        return [
            'no facts list' => ['{"user":"S-1-5-21-1"}'],
            'facts that are not a list' => ['{"facts":{"path":"C:\\\\x"}}'],
            'an entry without a path' => ['{"facts":[{"reparse":false,"writers":[]}]}'],
            'a reparse flag that is not a boolean' => ['{"facts":[{"path":"C:\\\\x","reparse":"False","writers":[]}]}'],
            'a writer that is not a string' => ['{"facts":[{"path":"C:\\\\x","reparse":false,"writers":[{"Value":"S-1-1-0"}]}]}'],
            'no writers list' => ['{"facts":[{"path":"C:\\\\x","reparse":false}]}'],
        ];
    }

    #[DataProvider('unexpectedOutputs')]
    public function testRefusesAnUnexpectedOutput(string $output): void
    {
        try {
            PowerShellPathFacts::factsOf(self::decoded($output));
            self::fail('The unexpected output was read.');
        } catch (BinaryRefusedException $refused) {
            self::assertSame(BinaryFailureCode::CacheUnsafe, $refused->failure->code);
            self::assertStringContainsString('cannot be read', $refused->failure->message);
        }
    }

    private static function decoded(string $json): \stdClass
    {
        $read = json_decode($json, false, 16, JSON_THROW_ON_ERROR);
        self::assertInstanceOf(\stdClass::class, $read);

        return $read;
    }
}
