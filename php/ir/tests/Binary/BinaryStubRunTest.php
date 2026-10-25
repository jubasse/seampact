<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryCompileOutput;
use Seampact\Ir\Binary\BinaryFailure;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryInstaller;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\BinaryRunner;
use Seampact\Ir\Binary\CacheRoot;
use Seampact\Ir\Binary\InstalledBinary;
use Seampact\Ir\Binary\PosixCacheSafety;
use Seampact\Ir\Tests\Support\StubBinary;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\TrustedAncestorFacts;

/**
 * The private copy, the environment and the exits, with stub compilers: only the hashed copy runs, the child sees
 * the contract's variables only, and each exit maps to its outcome.
 */
#[RequiresOperatingSystemFamily('Linux')]
final class BinaryStubRunTest extends TestCase
{
    private const TIMEOUT_SECONDS = 10.0;

    private string $directory;

    private string $cacheRoot;

    private string $config;

    protected function setUp(): void
    {
        $this->directory = TemporaryDirectory::create('seampact-run-');
        $this->cacheRoot = "{$this->directory}/cache/seampact";
        $this->config = TemporaryDirectory::write($this->directory, 'app/seampact.config.yaml', "apis: {}\n");
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->directory);
    }

    public function testRunsTheCopyAndReadsTheIrOfEachApi(): void
    {
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop', 'admin'], '', '{"irVersion":1}'));

        $output = $this->compile($binary, ['shop', 'admin']);

        self::assertTrue($output->compiled());
        self::assertSame(['shop' => '{"irVersion":1}', 'admin' => '{"irVersion":1}'], $output->irTextByApi);
        self::assertSame("{$this->cacheRoot}/{$binary->sha256}/seampact", $binary->path);
        self::assertSame(0700, fileperms(dirname($binary->path)) & 0777);
        self::assertSame(0700, fileperms($this->cacheRoot) & 0777);
    }

    public function testCreatesTheCacheOwnerOnlyWhateverTheUmask(): void
    {
        $previous = umask(0);

        try {
            $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", []));
        } finally {
            umask($previous);
        }

        self::assertSame(0700, fileperms(dirname($this->cacheRoot)) & 0777);
        self::assertSame(0700, fileperms($this->cacheRoot) & 0777);
        self::assertSame(0700, fileperms(dirname($binary->path)) & 0777);
    }

    public function testNeverRunsTheOriginalSwappedAfterTheHash(): void
    {
        $original = StubBinary::compiler("{$this->directory}/compiler", ['shop']);
        $binary = $this->installed($original);
        $marker = "{$this->directory}/swapped-original-ran";
        StubBinary::compiler($original, ['shop'], 'touch ' . escapeshellarg($marker));

        $output = $this->compile($binary, ['shop']);

        self::assertTrue($output->compiled());
        self::assertFileDoesNotExist($marker);
    }

    public function testNeverRunsACopyChangedAfterItsInstall(): void
    {
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop']));
        $marker = "{$this->directory}/changed-copy-ran";
        StubBinary::compiler($binary->path, ['shop'], 'touch ' . escapeshellarg($marker));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::HashMismatch, $refused->code);
        self::assertFileDoesNotExist($marker);
    }

    public function testRefusesACacheDirectoryOthersCanWrite(): void
    {
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop']));
        chmod(dirname($binary->path), 0777);

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::CacheUnsafe, $refused->code);
        self::assertStringContainsString('chmod 700', $refused->fix);
    }

    public function testStartsTheChildWithTheContractVariablesOnly(): void
    {
        $environmentDump = "{$this->directory}/environment";
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop'], '/usr/bin/env > ' . escapeshellarg($environmentDump)));

        $this->compile($binary, ['shop'], [
            'OPENSSL_CONF' => "{$this->directory}/evil.cnf",
            'NODE_OPTIONS' => '--require /tmp/evil.js',
            'LD_PRELOAD' => '/tmp/evil.so',
            'TMPDIR' => sys_get_temp_dir(),
        ]);

        $environment = (string) file_get_contents($environmentDump);
        self::assertStringNotContainsString('OPENSSL_CONF', $environment);
        self::assertStringNotContainsString('NODE_OPTIONS', $environment);
        self::assertStringNotContainsString('LD_PRELOAD', $environment);
        self::assertStringContainsString('TMPDIR=' . sys_get_temp_dir(), $environment);
    }

    public function testRunsFromTheAppConfigDirectoryWithAbsolutePaths(): void
    {
        $arguments = "{$this->directory}/arguments";
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop'], 'pwd > ' . escapeshellarg($arguments)));

        $this->compile($binary, ['shop']);

        self::assertSame(dirname($this->config) . "\n", file_get_contents($arguments));
    }

    public function testRefusesAnExitOneWithItsDiagnosticsWithoutControlCharacters(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", "printf 'error \\033[31mred\\033[0m\\tat line 1\\r\\nnext\\n' >&2\nexit 1"));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::CompileRefused, $refused->code);
        self::assertStringContainsString('code 1', $refused->message);
        self::assertStringContainsString("error [31mred[0m\tat line 1\nnext\n", $refused->message);
    }

    public function testRefusesAUsageErrorWithItsDiagnostics(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", "echo 'unknown option' >&2\nexit 2"));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::CompileRefused, $refused->code);
        self::assertStringContainsString('code 2', $refused->message);
        self::assertStringContainsString("unknown option\n", $refused->message);
    }

    public function testStripsC1ControlsFromDiagnosticsThatAreNotValidUtf8(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", "printf 'bad \\377 csi \\302\\23331m raw \\233 end' >&2\nexit 1"));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertStringNotContainsString("\u{9b}", $refused->message);
        self::assertStringNotContainsString("\x9b", $refused->message);
        self::assertStringContainsString('csi 31m raw', $refused->message);
    }

    public function testNeverRunsAFilePlantedBesideTheConfigUnderARelativeCacheVariable(): void
    {
        $marker = "{$this->directory}/planted-ran";
        $source = StubBinary::compiler("{$this->directory}/compiler", ['shop']);
        $sha256 = StubBinary::sha256($source);
        TemporaryDirectory::write($this->directory, "app/relative-cache/seampact/{$sha256}/seampact", '');
        StubBinary::script("{$this->directory}/app/relative-cache/seampact/{$sha256}/seampact", 'touch ' . escapeshellarg($marker));
        $workingDirectory = getcwd();
        self::assertIsString($workingDirectory);
        chdir($this->directory);

        try {
            $refused = $this->refusal(function () use ($source, $sha256): void {
                $cacheRoot = CacheRoot::locate(['COMPOSER_CACHE_DIR' => 'relative-cache', 'HOME' => $this->directory], false);
                $safety = new PosixCacheSafety($cacheRoot, new TrustedAncestorFacts($this->directory));
                $this->compile(BinaryInstaller::install($source, $sha256, $cacheRoot, 'seampact', $safety), ['shop']);
            });
        } finally {
            chdir($workingDirectory);
        }

        self::assertFileDoesNotExist($marker);
        self::assertSame(BinaryFailureCode::CacheUnavailable, $refused->code);
        self::assertStringContainsString('COMPOSER_CACHE_DIR', $refused->message);
    }

    public function testChecksAndRunsTheRealPathOfACacheReachedThroughALink(): void
    {
        mkdir("{$this->directory}/private", 0700);
        symlink("{$this->directory}/private", "{$this->directory}/link");
        $cacheRoot = "{$this->directory}/link/seampact";
        $source = StubBinary::compiler("{$this->directory}/compiler", ['shop']);
        $safety = new PosixCacheSafety($cacheRoot, new TrustedAncestorFacts($this->directory));

        $binary = BinaryInstaller::install($source, StubBinary::sha256($source), $cacheRoot, 'seampact', $safety);

        self::assertSame("{$this->directory}/private/seampact/{$binary->sha256}/seampact", $binary->path);
        self::assertTrue($this->compile($binary, ['shop'])->compiled());
    }

    public function testRefusesAnyOtherExitCode(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", 'exit 3'));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::CompileFailed, $refused->code);
        self::assertStringContainsString('code 3', $refused->message);
    }

    public function testRefusesASignal(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", 'kill -9 $$'));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop']));

        self::assertSame(BinaryFailureCode::CompileFailed, $refused->code);
        self::assertStringContainsString('signal 9', $refused->message);
    }

    public function testRefusesAMissingIrAfterExitZero(): void
    {
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop']));

        $refused = $this->refusal(fn () => $this->compile($binary, ['shop', 'admin']));

        self::assertSame(BinaryFailureCode::CompileFailed, $refused->code);
        self::assertStringContainsString("'admin'", $refused->message);
    }

    public function testStopsACompilePastItsDeadline(): void
    {
        $binary = $this->installed(StubBinary::script("{$this->directory}/compiler", 'exec /bin/sleep 30'));
        $started = hrtime(true);

        $refused = $this->refusal(fn () => BinaryRunner::compile($binary, $this->config, ['shop'], 0.3, [], false));

        self::assertSame(BinaryFailureCode::CompileTimeout, $refused->code);
        self::assertLessThan(10e9, hrtime(true) - $started);
    }

    public function testRemovesItsOutputDirectory(): void
    {
        $before = glob(sys_get_temp_dir() . '/seampact-compile-*') ?: [];
        $binary = $this->installed(StubBinary::compiler("{$this->directory}/compiler", ['shop']));

        $this->compile($binary, ['shop']);

        self::assertSame($before, glob(sys_get_temp_dir() . '/seampact-compile-*') ?: []);
    }

    private function installed(string $source): InstalledBinary
    {
        $safety = new PosixCacheSafety($this->cacheRoot, new TrustedAncestorFacts($this->directory));

        return BinaryInstaller::install($source, StubBinary::sha256($source), $this->cacheRoot, 'seampact', $safety);
    }

    /**
     * @param list<string> $apis
     * @param array<string, string> $environment
     */
    private function compile(InstalledBinary $binary, array $apis, array $environment = []): BinaryCompileOutput
    {
        return BinaryRunner::compile($binary, $this->config, $apis, self::TIMEOUT_SECONDS, $environment, false);
    }

    private function refusal(callable $action): BinaryFailure
    {
        try {
            $action();
        } catch (BinaryRefusedException $refused) {
            return $refused->failure;
        }

        self::fail('The binary was not refused.');
    }
}
