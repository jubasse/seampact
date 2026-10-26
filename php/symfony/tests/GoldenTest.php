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
 * and with `rules: seampact-consistent` and an indent of two spaces in a namespace of its own.
 */
final class GoldenTest extends TestCase
{
    private const GOLDEN_DIRECTORY = __DIR__ . '/golden';
    private const UPDATE_VARIABLE = 'SEAMPACT_UPDATE_GOLDEN';

    public function testTheGeneratedTreeIsTheCommittedGolden(): void
    {
        $generator = new SymfonyGenerator();
        $trees = [
            'Tasks' => $generator->generate(ReferenceContract::core(new SymfonyGenerator()), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::core(new SymfonyGenerator()),
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

    public function testTheFullReferenceContractIsRefusedFormByForm(): void
    {
        $ir = ReferenceContract::read(new SymfonyGenerator(), ReferenceContract::document(ReferenceContract::TASKS));

        try {
            (new SymfonyGenerator())->generate($ir, ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
            self::fail('The full reference contract was generated, but it carries forms a later release brings.');
        } catch (GenerationRefusedException $refused) {
            $codes = array_values(array_unique(array_map(static fn (ConfigProblem $problem): string => $problem->code, $refused->problems)));
            sort($codes);

            self::assertSame(
                [
                    'access.signed.unsupported', 'cache.unsupported', 'deadline.unsupported', 'error.retryHeader.unsupported', 'idempotency.unsupported',
                    'input.proofs.unsupported', 'input.rawBody.unsupported', 'paging.unsupported', 'param.query.structured.unsupported',
                    'requires.right.unsupported', 'requires.rule.unsupported',
                    'response.header.unsupported', 'response.shape.unsupported', 'throttle.unsupported', 'type.opaque.unsupported',
                ],
                $codes,
            );
            self::assertStringContainsString("entry 'server' /operations/", $refused->getMessage());
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
