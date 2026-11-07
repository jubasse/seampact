<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleChannel;
use Seampact\Ir\Bundle\BundleEntry;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Bundle\BundleTarball;
use Seampact\Ir\Bundle\BundleVerifier;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** The shared bundle vectors (`packages/core/spec/vectors/bundle/vectors.json`): every field a vector records. */
final class BundleVectorsTest extends TestCase
{
    private const VECTORS = '/packages/core/spec/vectors/bundle/vectors.json';

    /** @return array<string, array{\stdClass}> */
    public static function directoryVectors(): array
    {
        return self::vectors('directories');
    }

    /** @return array<string, array{\stdClass}> */
    public static function archiveVectors(): array
    {
        return self::vectors('archives');
    }

    #[DataProvider('directoryVectors')]
    public function testVerifiesTheDirectoryAsTheVectorRecords(\stdClass $vector): void
    {
        $directory = TemporaryDirectory::create('seampact-vector-');

        try {
            foreach (Json::objects($vector, 'files') as $file) {
                TemporaryDirectory::write($directory, Json::string($file, 'path'), self::decoded(Json::string($file, 'base64')));
            }

            $verification = BundleVerifier::verify(
                $directory,
                self::nullableString($vector, 'pin'),
                BundleChannel::from(Json::string($vector, 'channel')),
            );
        } finally {
            TemporaryDirectory::remove($directory);
        }

        $expected = Json::object(Json::member($vector, 'expected'));
        self::assertSame(Json::member($expected, 'ok'), $verification->ok);
        self::assertSame(self::nullableString($expected, 'integrity'), $verification->integrity);
        self::assertSame(self::expectedFailures($expected), self::failures($verification->failures));
    }

    #[DataProvider('archiveVectors')]
    public function testReadsTheArchiveAsTheVectorRecords(\stdClass $vector): void
    {
        $read = BundleTarball::read(self::decoded(Json::string($vector, 'base64')));

        $expected = Json::object(Json::member($vector, 'expected'));
        self::assertSame(Json::member($expected, 'ok'), $read->failures === []);
        self::assertSame(Json::strings($expected, 'paths'), array_map(static fn (BundleEntry $entry): string => $entry->path, $read->entries));
        self::assertSame(self::expectedFailures($expected), self::failures($read->failures));
    }

    public function testExtractsTheValidArchiveIntoAPrivateDirectoryThatVerifies(): void
    {
        $archive = self::archiveVectors()['valid'][0];
        $pin = self::nullableString(self::directoryVectors()['valid'][0], 'pin');
        $parent = TemporaryDirectory::create('seampact-extract-');

        try {
            $directory = BundleTarball::extract(self::decoded(Json::string($archive, 'base64')), $parent);
            self::assertIsString($directory);
            self::assertSame(0700, fileperms($directory) & 0777);

            $verification = BundleVerifier::verify($directory, $pin, BundleChannel::Release);
        } finally {
            TemporaryDirectory::remove($parent);
        }

        self::assertSame([], self::failures($verification->failures));
        self::assertSame(['t'], array_keys($verification->irs));
    }

    /** @return array<string, array{\stdClass}> */
    private static function vectors(string $kind): array
    {
        $vectors = Json::object(Json::decodeFile(Documents::repositoryRoot() . self::VECTORS));
        $cases = [];

        foreach (Json::objects($vectors, $kind) as $vector) {
            $cases[Json::string($vector, 'id')] = [$vector];
        }

        return $cases;
    }

    // A member the vectors write as a string or null.
    private static function nullableString(\stdClass $object, string $member): ?string
    {
        $value = Json::member($object, $member);
        self::assertTrue($value === null || is_string($value), $member);

        return $value;
    }

    private static function decoded(string $base64): string
    {
        $bytes = base64_decode($base64, true);
        self::assertIsString($bytes);

        return $bytes;
    }

    /** @return list<array<array-key, string>> */
    private static function expectedFailures(\stdClass $expected): array
    {
        return array_map(
            static fn (\stdClass $failure): array => array_map(
                static fn (mixed $value): string => is_string($value) ? $value : (string) json_encode($value),
                get_object_vars($failure),
            ),
            Json::objects($expected, 'failures'),
        );
    }

    /**
     * Each failure as the vectors record it: the code, then each of file, expected and actual when set.
     *
     * @param list<BundleFailure> $failures
     * @return list<array<string, string>>
     */
    private static function failures(array $failures): array
    {
        return array_map(
            static fn (BundleFailure $failure): array => array_filter(
                ['code' => $failure->code->value, 'file' => $failure->file, 'expected' => $failure->expected, 'actual' => $failure->actual],
                static fn (?string $value): bool => $value !== null,
            ),
            $failures,
        );
    }
}
