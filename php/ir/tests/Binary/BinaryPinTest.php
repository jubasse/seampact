<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryPins;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\CompilerBinary;
use Seampact\Ir\Binary\HostLibc;
use Seampact\Ir\Binary\HostPlatform;
use Seampact\Ir\Binary\RootPackage;
use Seampact\Ir\Tests\Support\StubBinary;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** The pin: only the root package's override, always with a hash, and a binary whose hash differs never starts. */
final class BinaryPinTest extends TestCase
{
    private const OTHER_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000';

    private string $project;

    protected function setUp(): void
    {
        $this->project = TemporaryDirectory::create('seampact-pin-');
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->project);
    }

    #[RequiresOperatingSystemFamily('Linux')]
    public function testAStubWithAWrongHashNeverStarts(): void
    {
        $marker = "{$this->project}/started";
        StubBinary::script("{$this->project}/compiler", 'touch ' . escapeshellarg($marker));
        $this->writeComposer(['path' => 'compiler', 'sha256' => self::OTHER_SHA256]);

        $refused = $this->refusal(fn () => $this->install());

        self::assertSame(BinaryFailureCode::HashMismatch, $refused->code);
        self::assertStringContainsString(self::OTHER_SHA256, $refused->message);
        self::assertStringContainsString(StubBinary::sha256("{$this->project}/compiler"), $refused->message);
        self::assertFileDoesNotExist($marker);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/*") ?: []);
    }

    /** @return array<string, array{array<string, mixed>, BinaryFailureCode}> */
    public static function refusedOverrides(): array
    {
        $everyAsset = [
            'seampact-linux-x64' => self::OTHER_SHA256,
            'seampact-linux-arm64' => self::OTHER_SHA256,
            'seampact-darwin-x64' => self::OTHER_SHA256,
            'seampact-darwin-arm64' => self::OTHER_SHA256,
            'seampact-win32-x64.exe' => self::OTHER_SHA256,
        ];

        return [
            'path without a hash' => [['path' => 'compiler'], BinaryFailureCode::PinMissing],
            'path with an upper-case hash' => [['path' => 'compiler', 'sha256' => strtoupper(str_repeat('ab', 32))], BinaryFailureCode::PinInvalid],
            'path with a short hash' => [['path' => 'compiler', 'sha256' => 'abc'], BinaryFailureCode::PinInvalid],
            'path and version' => [['path' => 'compiler', 'version' => '1.0.0', 'sha256' => self::OTHER_SHA256], BinaryFailureCode::PinInvalid],
            'an unknown key' => [['path' => 'compiler', 'sha256' => self::OTHER_SHA256, 'insecure' => true], BinaryFailureCode::PinInvalid],
            'version lacking an asset hash' => [['version' => '1.0.0', 'sha256' => array_slice($everyAsset, 0, 4)], BinaryFailureCode::PinMissing],
            'version with an unknown asset' => [['version' => '1.0.0', 'sha256' => [...$everyAsset, 'seampact-freebsd-x64' => self::OTHER_SHA256]], BinaryFailureCode::PinInvalid],
            'url without hashes' => [['url' => 'https://mirror.example/seampact'], BinaryFailureCode::PinMissing],
            'version, before publication' => [['version' => '1.0.0', 'sha256' => $everyAsset], BinaryFailureCode::Unpublished],
            'url, before publication' => [['url' => 'https://mirror.example/seampact', 'sha256' => $everyAsset], BinaryFailureCode::Unpublished],
        ];
    }

    /** @param array<string, mixed> $binary */
    #[DataProvider('refusedOverrides')]
    public function testRefusesAnOverrideByName(array $binary, BinaryFailureCode $code): void
    {
        $this->writeComposer($binary);

        self::assertSame($code, $this->refusal(fn () => $this->install())->code);
    }

    public function testRefusesAnyInputWithoutAPathOverrideAsUnpublished(): void
    {
        $this->writeComposer(null);

        $refused = $this->refusal(fn () => $this->install());

        self::assertSame(BinaryFailureCode::Unpublished, $refused->code);
        self::assertStringContainsString('"path"', $refused->fix);
    }

    public function testShipsEmptyPinsUntilPublication(): void
    {
        self::assertNull(BinaryPins::embedded());
    }

    public function testRefusesABinaryOverrideSetByADependency(): void
    {
        $this->writeComposer(['path' => 'compiler', 'sha256' => self::OTHER_SHA256]);
        TemporaryDirectory::write($this->project, 'vendor/composer/installed.json', (string) json_encode([
            'packages' => [
                ['name' => 'acme/harmless'],
                ['name' => 'evil/binary', 'extra' => ['seampact' => ['binary' => ['path' => '/tmp/x', 'sha256' => self::OTHER_SHA256]]]],
            ],
        ]));

        $refused = $this->refusal(fn () => $this->install());

        self::assertSame(BinaryFailureCode::OverrideNotRoot, $refused->code);
        self::assertStringContainsString("'evil/binary'", $refused->message);
    }

    public function testReadsTheRootComposerFileTheComposerVariableNames(): void
    {
        $this->writeComposer(null);
        TemporaryDirectory::write($this->project, 'other.json', (string) json_encode(['extra' => ['seampact' => ['binary' => ['path' => 'compiler']]]]));

        $refused = $this->refusal(fn () => RootPackage::locate($this->project, ['COMPOSER' => 'other.json'])->binaryOverride());

        self::assertSame(BinaryFailureCode::PinMissing, $refused->code);
        self::assertStringContainsString('other.json', $refused->message);
    }

    /** @param ?array<string, mixed> $binary */
    private function writeComposer(?array $binary): void
    {
        $composer = ['name' => 'acme/app'];
        if ($binary !== null) {
            $composer['extra'] = ['seampact' => ['binary' => $binary]];
        }

        TemporaryDirectory::write($this->project, 'composer.json', (string) json_encode($composer));
    }

    private function install(): void
    {
        CompilerBinary::install(
            RootPackage::locate($this->project, []),
            "{$this->project}/vendor",
            new HostPlatform('Linux', 'x86_64', HostLibc::Glibc),
            ['COMPOSER_CACHE_DIR' => "{$this->project}/cache"],
        );
    }

    private function refusal(callable $action): \Seampact\Ir\Binary\BinaryFailure
    {
        try {
            $action();
        } catch (BinaryRefusedException $refused) {
            return $refused->failure;
        }

        self::fail('The binary was not refused.');
    }
}
