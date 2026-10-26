<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\GoldenTree;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Symfony\SymfonyGenerator;

/**
 * The reference contract's apis generated with the operations this release serves, compared byte for byte with the
 * committed tree under `tests/golden`, which PHPStan then analyses at level max against Symfony and CI lints with
 * `php -l`. `SEAMPACT_UPDATE_GOLDEN=1` rewrites the tree instead. The tasks api is generated twice: with every default,
 * and with `rules: seampact-consistent` and an indent of two spaces in a namespace of its own, where, beside the core
 * operations, it holds the writes with their idempotency, a right and a rule with its body proof (`updateTask` and
 * `purgeTask`), the paged `listTasks`, the cached `getPreferences`, the signed `payments`, the deadline budget of
 * `searchTasks`, and a sensitive `CreateTask.title`.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';
    private const SENSITIVE_SCHEMA = 'CreateTask';

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $generator = new SymfonyGenerator();
        $trees = [
            'Tasks' => $generator->generate(ReferenceContract::core(new SymfonyGenerator()), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::read(new SymfonyGenerator(), self::withServedOperations()),
                ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\TasksConsistent', ['rules' => 'seampact-consistent', 'indent' => 2]),
            ),
        ];

        $golden = new GoldenTree(self::GOLDEN_DIRECTORY);
        $generated = GoldenTree::flattened($trees);

        if (getenv(self::UPDATE_VARIABLE) === '1') {
            $golden->rewrite($generated);
        }

        self::assertSame(array_keys($golden->committed()), array_keys($generated), 'The generated file list differs from the golden; run with ' . self::UPDATE_VARIABLE . '=1 to accept it.');
        foreach ($golden->committed() as $path => $contents) {
            self::assertSame($contents, $generated[$path], "{$path} differs from the golden; run with " . self::UPDATE_VARIABLE . '=1 to accept it.');
        }
    }

    private static function withServedOperations(): \stdClass
    {
        $document = ReferenceContract::kept(
            ReferenceContract::document(ReferenceContract::TASKS),
            [...ReferenceContract::CORE_OPERATIONS, 'createTask', 'updateTask', 'purgeTask', 'listTasks', 'getPreferences', 'payments', 'searchTasks'],
        );

        // An input-only member made sensitive, so the golden holds a redacted schema class.
        $schemas = $document->schemas ?? null;
        $createTask = $schemas instanceof \stdClass ? $schemas->{self::SENSITIVE_SCHEMA} ?? null : null;
        $title = $createTask instanceof \stdClass && is_array($createTask->properties) ? $createTask->properties[0] : null;
        if (!$title instanceof \stdClass) {
            throw new \LogicException('The reference IR lost the first property of ' . self::SENSITIVE_SCHEMA . '.');
        }
        $title->sensitive = true;

        return $document;
    }

    public function testBothApisOfTheFullReferenceContractGenerate(): void
    {
        foreach ([ReferenceContract::TASKS => 'tasks', ReferenceContract::TASKS_SERVICE => 'tasksService'] as $file => $api) {
            $ir = ReferenceContract::read(new SymfonyGenerator(), ReferenceContract::document($file));
            $files = (new SymfonyGenerator())->generate($ir, ReferenceContract::entry(SymfonyGenerator::PACKAGE, $api, 'App\\Generated'));

            self::assertNotSame([], $files, "The api '{$api}' generated no file.");
        }
    }

    public function testAPathSegmentMixingAParameterWithTextIsRefusedByName(): void
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation): void {
            $operation->path = '/v1/channels/{channelId}/tasks/task-{taskId}';
        });

        try {
            (new SymfonyGenerator())->generate(ReferenceContract::read(new SymfonyGenerator(), $document), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
            self::fail('A mixed path segment was generated.');
        } catch (GenerationRefusedException $refused) {
            self::assertSame(['path.segment.mixed.unsupported'], array_map(static fn (ConfigProblem $problem): string => $problem->code, $refused->problems));
            self::assertStringContainsString("entry 'server' /operations/0/path (operation 'getTask')", $refused->getMessage());
        }
    }
}
