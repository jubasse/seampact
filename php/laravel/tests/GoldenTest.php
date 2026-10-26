<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\Tests\Support\ReferenceContract;

/**
 * The reference contract's apis generated with the operations this release serves, compared byte for byte with the
 * committed tree under `tests/golden`, which PHPStan then analyses at level max against Laravel 13 and CI lints with
 * `php -l`. `SEAMPACT_UPDATE_GOLDEN=1` rewrites the tree instead. The tasks api is generated twice: with every default,
 * and with `routes: file` and `rules: seampact-consistent` in a namespace of its own.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $generator = new LaravelGenerator();
        $trees = [
            'Tasks' => $generator->generate(ReferenceContract::core(), ReferenceContract::entry('tasks', 'Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::core(),
                ReferenceContract::entry('tasks', 'Seampact\\Golden\\TasksConsistent', ['routes' => 'file', 'rules' => 'seampact-consistent']),
            ),
        ];

        $generated = [];
        foreach ($trees as $directory => $files) {
            foreach ($files as $file) {
                $generated["{$directory}/{$file->path}"] = $file->contents;
            }
        }
        ksort($generated);

        if (getenv(self::UPDATE_VARIABLE) === '1') {
            $this->rewriteGolden($generated);
        }

        self::assertSame(array_keys($this->committedTree()), array_keys($generated), 'The generated file list differs from the golden; run with ' . self::UPDATE_VARIABLE . '=1 to accept it.');
        foreach ($this->committedTree() as $path => $contents) {
            self::assertSame($contents, $generated[$path], "{$path} differs from the golden; run with " . self::UPDATE_VARIABLE . '=1 to accept it.');
        }
    }

    public function testTheFullReferenceContractIsRefusedFormByForm(): void
    {
        $ir = ReferenceContract::read(ReferenceContract::document(ReferenceContract::TASKS));

        try {
            (new LaravelGenerator())->generate($ir, ReferenceContract::entry('tasks', 'App\\Tasks'));
            self::fail('The full reference contract was generated, but it carries forms a later release brings.');
        } catch (GenerationRefusedException $refused) {
            $codes = array_values(array_unique(array_map(static fn ($problem): string => $problem->code, $refused->problems)));
            sort($codes);

            self::assertSame(
                [
                    'access.signed.unsupported', 'cache.unsupported', 'deadline.unsupported', 'error.retryHeader.unsupported', 'idempotency.unsupported',
                    'input.proofs.unsupported', 'input.rawBody.unsupported', 'paging.unsupported', 'param.query.structured.unsupported',
                    'response.header.unsupported', 'response.shape.unsupported', 'type.opaque.unsupported',
                ],
                $codes,
            );
            self::assertStringContainsString("entry 'server' /operations/", $refused->getMessage());
        }
    }

    /** @return array<string, string> */
    private function committedTree(): array
    {
        $tree = [];
        if (!is_dir(self::GOLDEN_DIRECTORY)) {
            return $tree;
        }

        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::GOLDEN_DIRECTORY, \FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (!$file instanceof \SplFileInfo || !$file->isFile()) {
                continue;
            }
            $relative = substr($file->getPathname(), strlen(self::GOLDEN_DIRECTORY) + 1);
            $tree[str_replace(DIRECTORY_SEPARATOR, '/', $relative)] = (string) file_get_contents($file->getPathname());
        }
        ksort($tree);

        return $tree;
    }

    /** @param array<string, string> $generated */
    private function rewriteGolden(array $generated): void
    {
        foreach (array_keys($this->committedTree()) as $path) {
            unlink(self::GOLDEN_DIRECTORY . '/' . $path);
        }

        foreach ($generated as $path => $contents) {
            $target = self::GOLDEN_DIRECTORY . '/' . $path;
            if (!is_dir(dirname($target))) {
                mkdir(dirname($target), 0o755, true);
            }
            file_put_contents($target, $contents);
        }
    }
}
