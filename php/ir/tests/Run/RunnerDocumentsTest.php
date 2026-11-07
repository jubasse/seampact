<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Run\Command;
use Seampact\Ir\Tests\Support\GitRepository;
use Seampact\Ir\Tests\Support\StubBinary;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\ValidBundle;

/**
 * `vendor/bin/seampact` with the app's OpenAPI documents: a stub binary stands in for the compiler, gets the checked
 * bundle handed over and runs before any entry is written, and its refusal leaves the entries as they were.
 */
#[RequiresOperatingSystemFamily('Linux')]
final class RunnerDocumentsTest extends TestCase
{
    // The binary cache refuses a world-writable ancestor such as /tmp, so it lives below this package's ignored cache.
    private const PRIVATE_PARENT = __DIR__ . '/../../.phpunit.cache';

    private string $project;

    private string $cacheDirectory;

    protected function setUp(): void
    {
        $this->project = TemporaryDirectory::create('seampact-documents-');
        if (!is_dir(self::PRIVATE_PARENT)) {
            self::assertTrue(mkdir(self::PRIVATE_PARENT, 0700, true));
        }
        $this->cacheDirectory = (string) realpath(self::PRIVATE_PARENT) . '/seampact-documents-cache-' . bin2hex(random_bytes(6));
        self::assertTrue(mkdir($this->cacheDirectory, 0700));

        mkdir("{$this->project}/.git");
        GitRepository::withValidBundle("{$this->project}/contract", 'bundle', 'v1');
        TemporaryDirectory::write($this->project, 'vendor/composer/installed.json', (string) json_encode(['packages' => [
            ['name' => 'acme/stub-target', 'version' => '1.2.0', 'extra' => ['seampact' => ['generator' => StubGenerator::class]]],
        ]]));
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->project);
        TemporaryDirectory::remove($this->cacheDirectory);
    }

    public function testHandsTheCheckedBundleToTheBinaryAndPrintsItsLines(): void
    {
        $this->stubBinary('echo "$@" > "' . $this->project . '/arguments"; echo "wrote openapi/t.json"; echo "entry \'stub\' uses \'acme/stub-target\', which its build plugin generates: left to it."; echo "warning: openapi.untested: a warning" >&2; exit 0');
        $this->config('');

        [$exit, $stdout, $stderr] = $this->seampact('generate');

        self::assertSame(Command::EXIT_PASSED, $exit, $stderr);
        self::assertStringContainsString('seampact: compiler: wrote openapi/t.json', $stdout);
        self::assertStringNotContainsString('left to it', $stdout);
        self::assertStringContainsString("entry 'stub' wrote 3 file(s)", $stdout);
        self::assertStringContainsString('seampact warning: openapi.untested: a warning', $stderr);
        self::assertMatchesRegularExpression(
            '#^generate --config ' . preg_quote("{$this->project}/seampact.config.yaml", '#') . ' --bundle-directory contract=' . preg_quote($this->cacheDirectory, '#') . '/seampact/bundles/sha256-[0-9a-f]{64}$#',
            trim((string) file_get_contents("{$this->project}/arguments")),
        );
    }

    public function testAsksTheBinaryToCheckTheDocumentsOnCheck(): void
    {
        $this->stubBinary('echo "$1" >> "' . $this->project . '/commands"; exit 0');
        $this->config('');
        $this->seampact('generate');

        [$exit, , $stderr] = $this->seampact('check');

        self::assertSame(Command::EXIT_PASSED, $exit, $stderr);
        self::assertSame("generate\ncheck\n", file_get_contents("{$this->project}/commands"));
    }

    public function testPassesForceToTheBinary(): void
    {
        $this->stubBinary('echo "$1 $2" > "' . $this->project . '/arguments"; exit 0');
        $this->config('');

        [$exit, , $stderr] = $this->seampact('generate', '--force');

        self::assertSame(Command::EXIT_PASSED, $exit, $stderr);
        self::assertSame("generate --force\n", file_get_contents("{$this->project}/arguments"));
    }

    public function testARefusedDocumentWritesNoEntry(): void
    {
        $this->stubBinary('echo "check.openapi.drift: openapi/t.json differs" >&2; exit 1');
        $this->config('');

        [$exit, , $stderr] = $this->seampact('generate');

        self::assertSame(Command::EXIT_REFUSED, $exit);
        self::assertStringContainsString('binary.documents-refused (openapi)', $stderr);
        self::assertStringContainsString('check.openapi.drift: openapi/t.json differs', $stderr);
        self::assertDirectoryDoesNotExist("{$this->project}/src/Generated");
    }

    public function testNeverStartsTheBinaryWithoutDocuments(): void
    {
        $this->stubBinary('touch "' . $this->project . '/started"; exit 0');
        $this->config("openapi: none\n");

        [$exit, , $stderr] = $this->seampact('generate');

        self::assertSame(Command::EXIT_PASSED, $exit, $stderr);
        self::assertFileDoesNotExist("{$this->project}/started");
    }

    private function stubBinary(string $body): void
    {
        $binary = StubBinary::script("{$this->project}/compiler", $body);
        TemporaryDirectory::write($this->project, 'composer.json', (string) json_encode([
            'autoload' => ['psr-4' => ['App\\' => 'src/']],
            'extra' => ['seampact' => ['phpPatched' => true, 'binary' => ['path' => $binary, 'sha256' => StubBinary::sha256($binary)]]],
        ]));
    }

    private function config(string $openapi): void
    {
        TemporaryDirectory::write($this->project, 'seampact.config.yaml', "sources:\n"
            . "  contract: { git: { url: ./contract, tag: v1, directory: bundle }, integrity: '" . ValidBundle::integrity() . "' }\n"
            . "outDir: src/Generated\n{$openapi}targets:\n  - { id: stub, use: acme/stub-target, api: t }\n");
    }

    /** @return array{int, string, string} */
    private function seampact(string ...$arguments): array
    {
        $stdout = fopen('php://memory', 'w+');
        $stderr = fopen('php://memory', 'w+');
        self::assertIsResource($stdout);
        self::assertIsResource($stderr);

        $environment = [...GitRepository::environment(), 'COMPOSER_CACHE_DIR' => $this->cacheDirectory];
        $exit = Command::run(array_values($arguments), $this->project, "{$this->project}/vendor", $environment, $stdout, $stderr);

        rewind($stdout);
        rewind($stderr);

        return [$exit, (string) stream_get_contents($stdout), (string) stream_get_contents($stderr)];
    }
}
