<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Tests\Support\Documents;

/** The schemas `seampact/ir` ships in `resources/schemas/` are byte-equal to those of `@seampact/spec`. */
final class SpecSchemaCopyTest extends TestCase
{
    private const SPEC_SCHEMAS = '/packages/core/spec/schemas';

    private const COPIES = __DIR__ . '/../../resources/schemas';

    /** @return array<string, array{string}> */
    public static function specSchemas(): array
    {
        $root = Documents::repositoryRoot() . self::SPEC_SCHEMAS;
        $cases = ['bundle/manifest.schema.json' => ['bundle/manifest.schema.json']];

        foreach (glob("{$root}/ir/*.schema.json") ?: [] as $file) {
            $cases['ir/' . basename($file)] = ['ir/' . basename($file)];
        }

        return $cases;
    }

    #[DataProvider('specSchemas')]
    public function testShipsAnExactCopyOfTheSpecSchema(string $relativePath): void
    {
        $spec = file_get_contents(Documents::repositoryRoot() . self::SPEC_SCHEMAS . '/' . $relativePath);
        $copy = @file_get_contents(self::COPIES . '/' . $relativePath);

        self::assertSame($spec, $copy, "Copy packages/core/spec/schemas/{$relativePath} to php/ir/resources/schemas/{$relativePath}.");
    }

    public function testShipsNoSchemaTheSpecDropped(): void
    {
        $copies = array_map(static fn (string $file): string => 'ir/' . basename($file), glob(self::COPIES . '/ir/*.json') ?: []);

        self::assertSame(array_keys(self::specSchemas()), ['bundle/manifest.schema.json', ...$copies]);
    }
}
