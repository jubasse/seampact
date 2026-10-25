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

    // The spec schema directories this package ships copies of, every schema of each.
    private const SCHEMA_DIRECTORIES = ['bundle', 'ir'];

    /** @return array<string, array{string}> */
    public static function specSchemas(): array
    {
        $root = Documents::repositoryRoot() . self::SPEC_SCHEMAS;
        $cases = [];

        foreach (self::SCHEMA_DIRECTORIES as $directory) {
            foreach (glob("{$root}/{$directory}/*.schema.json") ?: [] as $file) {
                $cases["{$directory}/" . basename($file)] = ["{$directory}/" . basename($file)];
            }
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
        $copies = [];
        foreach (self::SCHEMA_DIRECTORIES as $directory) {
            foreach (glob(self::COPIES . "/{$directory}/*.json") ?: [] as $file) {
                $copies[] = "{$directory}/" . basename($file);
            }
        }

        self::assertSame(array_keys(self::specSchemas()), $copies);
    }
}
