<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\GoldenTree;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Laravel\LaravelGenerator;

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
            'Tasks' => $generator->generate(ReferenceContract::core(new LaravelGenerator()), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\Tasks')),
            'TasksConsistent' => $generator->generate(
                ReferenceContract::core(new LaravelGenerator()),
                ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'Seampact\\Golden\\TasksConsistent', ['routes' => 'file', 'rules' => 'seampact-consistent']),
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
        $ir = ReferenceContract::read(new LaravelGenerator(), ReferenceContract::document(ReferenceContract::TASKS));

        try {
            (new LaravelGenerator())->generate($ir, ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
            self::fail('The full reference contract was generated, but it carries forms a later release brings.');
        } catch (GenerationRefusedException $refused) {
            $codes = array_values(array_unique(array_map(static fn ($problem): string => $problem->code, $refused->problems)));
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
}
