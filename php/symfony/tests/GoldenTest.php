<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Symfony\Shared\PendingSharedTypes;
use Seampact\Symfony\SymfonyGenerator;
use Seampact\Symfony\Tests\Support\PlaceholderSharedTypes;
use Seampact\Symfony\Tests\Support\ReferenceContract;

/**
 * The reference contract's tasks api generated with the operations this release serves, compared byte for byte with
 * the committed tree under `tests/golden`, which PHPStan then analyses at level max against Symfony and CI lints with
 * `php -l`. `SEAMPACT_UPDATE_GOLDEN=1` rewrites the tree instead. The api is generated twice: with every default, and
 * with `rules: seampact-consistent` and an indent of two spaces in a namespace of its own.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $generator = new SymfonyGenerator(new PlaceholderSharedTypes());
        $trees = [
            'Tasks' => $generator->generate(ReferenceContract::core(), ReferenceContract::entry('Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::core(),
                ReferenceContract::entry('Seampact\\Golden\\TasksConsistent', ['rules' => 'seampact-consistent', 'indent' => 2]),
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

        $committed = $this->committedTree();
        self::assertSame(array_keys($committed), array_keys($generated), 'The generated file list differs from the golden; run with ' . self::UPDATE_VARIABLE . '=1 to accept it.');
        foreach ($committed as $path => $contents) {
            self::assertSame($contents, $generated[$path], "{$path} differs from the golden; run with " . self::UPDATE_VARIABLE . '=1 to accept it.');
        }
    }

    public function testTheTargetRefusesEveryApiUntilItGeneratesTheSharedTypes(): void
    {
        try {
            (new SymfonyGenerator())->generate(ReferenceContract::core(), ReferenceContract::entry('App\\Tasks'));
            self::fail('The symfony target generated a placement without its value types.');
        } catch (GenerationRefusedException $refused) {
            self::assertSame([PendingSharedTypes::CODE], array_map(static fn ($problem): string => $problem->code, $refused->problems));
        }
    }

    public function testAPathSegmentMixingAParameterWithTextIsRefusedByName(): void
    {
        $document = ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS), ['getTask']);
        self::assertIsArray($document->operations);
        $operation = $document->operations[0];
        self::assertInstanceOf(\stdClass::class, $operation);
        $operation->path = '/v1/channels/{channelId}/tasks/task-{taskId}';

        try {
            (new SymfonyGenerator(new PlaceholderSharedTypes()))->generate(ReferenceContract::read($document), ReferenceContract::entry('App\\Tasks'));
            self::fail('A mixed path segment was generated.');
        } catch (GenerationRefusedException $refused) {
            self::assertSame(['path.segment.mixed.unsupported'], array_map(static fn ($problem): string => $problem->code, $refused->problems));
            self::assertStringContainsString("entry 'server' /operations/0/path (operation 'getTask')", $refused->getMessage());
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
