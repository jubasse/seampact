<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Laravel\LaravelGenerator;

/** An entry's `mount`: the contract routes, the route helpers and the boundary's base paths sit under it. */
final class MountTest extends TestCase
{
    private const MOUNT = '/api';

    public function testEachContractRouteIsRegisteredUnderTheMount(): void
    {
        $routes = self::generatedFile('TasksRoutes.php');

        self::assertStringContainsString("'uri' => '/api/v1/channels/{channelId}/tasks/{taskId}'", $routes);
        self::assertStringNotContainsString("'uri' => '/v1/", $routes);
    }

    public function testTheRouteHelpersPrependTheMount(): void
    {
        self::assertStringContainsString("return '/api/v1/health';", self::generatedFile('TasksUrls.php'));
    }

    public function testTheContractClassCarriesTheMountTheBoundaryMatchesUnder(): void
    {
        self::assertStringContainsString("public const MOUNT = '/api';", self::generatedFile('TasksContract.php'));
    }

    public function testAnEntryWithoutAMountServesTheContractPaths(): void
    {
        self::assertStringContainsString("public const MOUNT = '';", self::generatedFile('TasksContract.php', null));
    }

    private static function generatedFile(string $pathSuffix, ?string $mount = self::MOUNT): string
    {
        $generator = new LaravelGenerator();
        $files = $generator->generate(ReferenceContract::core($generator), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', 'App\\Tasks', mount: $mount));
        foreach ($files as $file) {
            if (str_ends_with($file->path, $pathSuffix)) {
                return $file->contents;
            }
        }

        self::fail("No generated file ends with '{$pathSuffix}'.");
    }
}
