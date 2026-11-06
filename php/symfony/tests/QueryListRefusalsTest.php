<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Run\GenerationRefusedException;
use Seampact\Symfony\SymfonyGenerator;

/**
 * The runtime reads a query value under its declared name, so a list sent in brackets form (`tag[]=a`, CHK-160) is
 * refused by name at generation rather than read as an undeclared key.
 */
final class QueryListRefusalsTest extends TestCase
{
    public function testAQueryListInBracketsFormIsRefusedByName(): void
    {
        $document = ReferenceContract::document(ReferenceContract::TASKS);
        $wire = self::listWireOf($document, 'listTasks');
        $wire->explode = true;
        $wire->brackets = true;

        self::assertContains('query.list.brackets.unsupported', self::refusedCodes($document));
    }

    private static function listWireOf(\stdClass $document, string $operationId): \stdClass
    {
        self::assertIsArray($document->operations);
        foreach ($document->operations as $operation) {
            if (!$operation instanceof \stdClass || $operation->id !== $operationId) {
                continue;
            }

            self::assertInstanceOf(\stdClass::class, $operation->params);
            self::assertIsArray($operation->params->query);
            foreach ($operation->params->query as $param) {
                $wire = $param instanceof \stdClass ? $param->wire ?? null : null;
                if ($wire instanceof \stdClass && $wire->kind === 'list') {
                    return $wire;
                }
            }
        }

        self::fail("The reference tasks api has no list query param on '{$operationId}'.");
    }

    /** @return list<string> */
    private static function refusedCodes(\stdClass $document): array
    {
        $generator = new SymfonyGenerator();

        try {
            $generator->generate(ReferenceContract::read($generator, $document), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks'));
        } catch (GenerationRefusedException $refused) {
            return array_map(static fn ($problem): string => $problem->code, $refused->problems);
        }

        self::fail('The contract was generated, but its brackets list should be refused.');
    }
}
