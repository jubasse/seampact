<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigReader;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\MatrixCheck;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/**
 * The framework version Composer installed against the `phpTargets` of the compatibility matrix, with the codes of
 * the Node CLI and the JVM plugins, and the matrix copy this package ships.
 */
final class MatrixCheckTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = TemporaryDirectory::create('seampact-matrix-');
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->directory);
    }

    public function testShipsAnExactCopyOfTheSpecMatrix(): void
    {
        self::assertSame(
            file_get_contents(Documents::repositoryRoot() . '/packages/core/spec/compatibility/matrix.json'),
            file_get_contents(__DIR__ . '/../../resources/compatibility/matrix.json'),
            'Copy packages/core/spec/compatibility/matrix.json to php/ir/resources/compatibility/matrix.json.',
        );
    }

    public function testPassesATestedMajor(): void
    {
        self::assertSame([[], []], $this->codes($this->config(''), ['laravel/framework' => 'v13.38.2']));
    }

    public function testRefusesAnIncompatibleMajorWithItsReason(): void
    {
        [$problems] = MatrixCheck::check($this->config(''), $this->installed(['laravel/framework' => 'v12.9.0']));

        self::assertSame('config.matrix.incompatible', $problems[0]->code);
        self::assertStringContainsString('does not work on laravel 12', $problems[0]->message);
    }

    public function testWarnsOnAnUntestedMajorUnlessTheChecksMakeItAnError(): void
    {
        self::assertSame([[], ['config.matrix.untested']], $this->codes($this->config(''), ['laravel/framework' => 'v14.0.0']));
        self::assertSame([['config.matrix.untested'], []], $this->codes($this->config('', "checks: { matrix: error }\n"), ['laravel/framework' => 'v14.0.0']));
    }

    public function testAcceptsAnUntestedMajorTheEntryAllows(): void
    {
        self::assertSame([[], []], $this->codes($this->config(', allowUntested: [laravel@14]'), ['laravel/framework' => 'v14.0.0']));
    }

    public function testNamesUselessAndForeignAllowUntestedItems(): void
    {
        self::assertSame(
            [['config.matrix.unknown-framework'], ['config.matrix.allowed-tested']],
            $this->codes($this->config(', allowUntested: [laravel@13, symfony@8]'), ['laravel/framework' => 'v13.38.2']),
        );
    }

    public function testRefusesAFrameworkComposerDidNotInstall(): void
    {
        self::assertSame([['framework.version.unresolved'], []], $this->codes($this->config(''), []));
    }

    private function config(string $entryMembers, string $more = ''): AppConfig
    {
        $file = TemporaryDirectory::write($this->directory, 'seampact.config.yaml', "sources:\n  contract: { path: contract }\n"
            . "outDir: src/Generated\nopenapi: none\n{$more}targets:\n  - { id: api, use: seampact/laravel, api: tasks{$entryMembers} }\n");
        $config = AppConfigReader::readFile($file);
        self::assertInstanceOf(AppConfig::class, $config, is_array($config) ? ConfigProblem::text($config) : '');

        return $config;
    }

    /**
     * @param array<string, string> $versions
     * @return array{list<string>, list<string>}
     */
    private function codes(AppConfig $config, array $versions): array
    {
        [$problems, $warnings] = MatrixCheck::check($config, $this->installed($versions));
        $code = static fn (ConfigProblem $problem): string => $problem->code;

        return [array_map($code, $problems), array_map($code, $warnings)];
    }

    /**
     * @param array<string, string> $versions
     * @return array<string, \stdClass>
     */
    private function installed(array $versions): array
    {
        $packages = [];
        foreach ($versions as $name => $version) {
            $packages[$name] = (object) ['name' => $name, 'version' => $version];
        }

        return $packages;
    }
}
