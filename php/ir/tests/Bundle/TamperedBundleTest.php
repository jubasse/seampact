<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleChannel;
use Seampact\Ir\Bundle\BundleFailureCode;
use Seampact\Ir\Bundle\BundleFile;
use Seampact\Ir\Bundle\BundleIntegrity;
use Seampact\Ir\Bundle\BundleVerification;
use Seampact\Ir\Bundle\BundleVerifier;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** A bundle changed after it was written: the check names what differs, and a resealed IR still meets its schema. */
final class TamperedBundleTest extends TestCase
{
    private const VECTORS = '/packages/core/spec/vectors/bundle/vectors.json';

    private const SOURCE = 'sources/api.yaml';

    private const IR = 'ir/t.json';

    private const MANIFEST = 'seampact-bundle.json';

    public function testNamesTheSourceFileWhoseBytesChanged(): void
    {
        $files = self::validFiles();
        $files[self::SOURCE] = strrev($files[self::SOURCE]);

        $verification = self::verify($files, self::validPin());

        self::assertFalse($verification->ok);
        self::assertCount(1, $verification->failures);
        self::assertSame(BundleFailureCode::FileHash, $verification->failures[0]->code);
        self::assertSame(self::SOURCE, $verification->failures[0]->file);
        self::assertStringContainsString("'" . self::SOURCE . "'", $verification->failures[0]->message);
    }

    public function testRefusesAResealedIrTheOpenIrSchemaRefuses(): void
    {
        $files = self::validFiles();
        $ir = Json::object(json_decode($files[self::IR], false, 512, JSON_THROW_ON_ERROR));
        Json::object($ir->api)->id = 42;
        $files[self::IR] = json_encode($ir, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
        [$files, $pin] = self::resealed($files);

        $verification = self::verify($files, $pin);

        self::assertFalse($verification->ok);
        self::assertSame($pin, $verification->integrity);
        self::assertSame(BundleFailureCode::IrInvalid, $verification->failures[0]->code);
        self::assertSame(self::IR, $verification->failures[0]->file);
        self::assertStringContainsString('/api/id', $verification->failures[0]->message);
    }

    /** @param array<string, string> $files */
    private static function verify(array $files, string $pin): BundleVerification
    {
        $directory = TemporaryDirectory::create('seampact-tampered-');

        try {
            foreach ($files as $path => $bytes) {
                TemporaryDirectory::write($directory, $path, $bytes);
            }

            return BundleVerifier::verify($directory, $pin, BundleChannel::Release);
        } finally {
            TemporaryDirectory::remove($directory);
        }
    }

    /**
     * The files with the manifest's sizes, hashes and integrity written again, and the new integrity to pin.
     *
     * @param array<string, string> $files
     * @return array{array<string, string>, string}
     */
    private static function resealed(array $files): array
    {
        $manifest = Json::object(json_decode($files[self::MANIFEST], false, 512, JSON_THROW_ON_ERROR));
        $listed = [];

        foreach (Json::objects($manifest, 'files') as $file) {
            $bytes = $files[Json::string($file, 'path')];
            $file->size = strlen($bytes);
            $file->sha256 = hash('sha256', $bytes);
            $listed[] = new BundleFile(Json::string($file, 'path'), $file->size, $file->sha256);
        }

        $manifest->integrity = BundleIntegrity::of($listed);
        $files[self::MANIFEST] = json_encode($manifest, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        return [$files, $manifest->integrity];
    }

    /** @return array<string, string> */
    private static function validFiles(): array
    {
        $files = [];
        foreach (Json::objects(self::validVector(), 'files') as $file) {
            $bytes = base64_decode(Json::string($file, 'base64'), true);
            self::assertIsString($bytes);
            $files[Json::string($file, 'path')] = $bytes;
        }

        return $files;
    }

    private static function validPin(): string
    {
        return Json::string(self::validVector(), 'pin');
    }

    private static function validVector(): \stdClass
    {
        $vectors = Json::object(Json::decodeFile(Documents::repositoryRoot() . self::VECTORS));
        foreach (Json::objects($vectors, 'directories') as $vector) {
            if (Json::string($vector, 'id') === 'valid') {
                return $vector;
            }
        }

        self::fail('The bundle vectors have no valid directory.');
    }
}
