<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\GoldenTree;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Run\FrameworkRoute;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Laravel\LaravelGenerator;

/**
 * The reference contract's apis generated with the operations this release serves, compared byte for byte with the
 * committed tree under `tests/golden`, which PHPStan then analyses at level max against Laravel 13 and CI lints with
 * `php -l`. `SEAMPACT_UPDATE_GOLDEN=1` rewrites the tree instead. The tasks api is generated twice: with every default, and in
 * a namespace of its own with `routes: file`, `rules: seampact-consistent`, two framework routes and, beside the core
 * operations, a right and a rule with its body proof (`updateTask` and `purgeTask`), the paged `listTasks`, the cached
 * `getPreferences`, the signed `payments`, and a sensitive `CreateTask.title`.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';
    private const SENSITIVE_SCHEMA = 'CreateTask';

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $generator = new LaravelGenerator();
        $trees = [
            'Tasks' => $generator->generate(ReferenceContract::core(new LaravelGenerator()), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::read(new LaravelGenerator(), self::withAccessOperations()),
                ReferenceContract::entry(
                    LaravelGenerator::PACKAGE,
                    'tasks',
                    'Seampact\\Golden\\TasksConsistent',
                    ['routes' => 'file', 'rules' => 'seampact-consistent'],
                    ['accessHooks' => true],
                    [new FrameworkRoute('/up', 'health', null), new FrameworkRoute('/admin/**', 'back office', 'GET')],
                ),
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

    private static function withAccessOperations(): \stdClass
    {
        $document = ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS), [...ReferenceContract::CORE_OPERATIONS, 'createTask', 'updateTask', 'purgeTask', 'listTasks', 'getPreferences', 'payments']);

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

    public function testTheFullReferenceContractIsRefusedFormByForm(): void
    {
        $ir = ReferenceContract::read(new LaravelGenerator(), ReferenceContract::document(ReferenceContract::TASKS));

        try {
            (new LaravelGenerator())->generate($ir, ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
            self::fail('The full reference contract was generated, but it carries forms a later release brings.');
        } catch (GenerationRefusedException $refused) {
            $codes = array_values(array_unique(array_map(static fn ($problem): string => $problem->code, $refused->problems)));
            sort($codes);

            self::assertSame(['deadline.unsupported'], $codes);
            self::assertStringContainsString("entry 'server' /operations/", $refused->getMessage());
        }
    }
}
