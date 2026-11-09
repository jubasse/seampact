<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\ApiPlatformFlavour;
use Seampact\ApiPlatform\ApiPlatformGenerator;
use Seampact\Codegen\GoldenTree;
use Seampact\Codegen\Tests\Support\PhpLint;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Symfony\SymfonyGenerator;

/**
 * The reference contract's tasks api, in its default format, generated for API Platform and compared byte for
 * byte with the committed tree under `tests/golden`, which PHPStan then analyses and CI lints; every file the target
 * does not add or change is the Symfony target's, byte for byte. `SEAMPACT_UPDATE_GOLDEN=1` rewrites
 * the tree instead.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';
    private const NAMESPACE = 'Seampact\\Golden\\Tasks';
    private const OPERATIONS = [...ReferenceContract::CORE_OPERATIONS, 'archiveTask'];

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $golden = new GoldenTree(self::GOLDEN_DIRECTORY);
        $generated = GoldenTree::flattened(['Tasks' => self::apiPlatformFiles()]);
        if (getenv(self::UPDATE_VARIABLE) === '1') {
            $golden->rewrite($generated);
        }

        self::assertSame(array_keys($golden->committed()), array_keys($generated), 'The generated file list differs from the golden; run with ' . self::UPDATE_VARIABLE . '=1 to accept it.');
        foreach ($golden->committed() as $path => $contents) {
            self::assertSame($contents, $generated[$path], "{$path} differs from the golden; run with " . self::UPDATE_VARIABLE . '=1 to accept it.');
        }
    }

    public function testEveryOtherFileIsTheSymfonyTargets(): void
    {
        $apiPlatform = self::byPath(self::apiPlatformFiles());
        $symfony = self::byPath((new SymfonyGenerator())->generate(self::ir(new SymfonyGenerator()), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', self::NAMESPACE)));

        $symfonyUnchanged = array_filter($symfony, static fn (string $path): bool => !self::isApiPlatformFile($path), ARRAY_FILTER_USE_KEY);
        $apiPlatformUnchanged = array_filter($apiPlatform, static fn (string $path): bool => !self::isApiPlatformFile($path), ARRAY_FILTER_USE_KEY);

        self::assertSame(self::withoutInputRules($symfonyUnchanged), $apiPlatformUnchanged);
    }

    public function testNoInputRulesInterfaceIsGeneratedAndTheFlavourRefusesThem(): void
    {
        self::assertTrue((new ApiPlatformFlavour())->refusesInputRules());
        self::assertSame([], array_filter(array_keys(self::byPath(self::apiPlatformFiles())), static fn (string $path): bool => str_contains($path, 'InputRules')));
    }

    public function testTheGeneratedTreeIsParsablePhp(): void
    {
        self::assertSame([], PhpLint::failures(self::apiPlatformFiles()));
    }

    /** @return list<GeneratedFile> */
    private static function apiPlatformFiles(): array
    {
        $generator = new ApiPlatformGenerator();

        return $generator->generate(self::ir($generator), ReferenceContract::entry(ApiPlatformGenerator::PACKAGE, 'tasks', self::NAMESPACE));
    }

    private static function ir(SymfonyGenerator|ApiPlatformGenerator $generator): \Seampact\Ir\Model\ContractIR
    {
        return ReferenceContract::read($generator, ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS), self::OPERATIONS));
    }

    /**
     * @param list<GeneratedFile> $files
     * @return array<string, string>
     */
    private static function byPath(array $files): array
    {
        $byPath = [];
        foreach ($files as $file) {
            $byPath[$file->path] = $file->contents;
        }

        return $byPath;
    }

    /**
     * The Symfony target's files as API Platform generates them: input rules are refused there, so the interface
     * and the contract's entry naming it are the one expected difference.
     *
     * @param array<string, string> $files
     * @return array<string, string>
     */
    private static function withoutInputRules(array $files): array
    {
        $kept = array_filter($files, static fn (string $path): bool => !str_ends_with($path, 'InputRules.php'), ARRAY_FILTER_USE_KEY);

        return array_map(static fn (string $contents): string => preg_replace("~^\\s*'inputRules' => .*\\n~m", '', $contents) ?? $contents, $kept);
    }

    private static function isApiPlatformFile(string $path): bool
    {
        return preg_match('~(^|/)ApiPlatform/~', $path) === 1 || str_ends_with($path, 'Boundary.php') || str_ends_with($path, 'SeampactBundle.php');
    }
}
