<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\RuntimeVersion;

/** The version check steps aside while the generate command runs, and only then: a later boot still refuses the skew. */
final class RegenerationTest extends TestCase
{
    /** @var array<array-key, mixed>|null */
    private ?array $argumentsBefore = null;

    protected function setUp(): void
    {
        $this->argumentsBefore = is_array($_SERVER['argv'] ?? null) ? $_SERVER['argv'] : null;
    }

    protected function tearDown(): void
    {
        $_SERVER['argv'] = $this->argumentsBefore;
    }

    public function testTheGenerateCommandRegistersTheApiUnderARuntimeVersionMismatch(): void
    {
        $_SERVER['argv'] = ['artisan', 'seampact:generate'];
        $config = new Repository(['seampact' => []]);
        $application = self::application();
        $application->instance('config', $config);

        (new SkewedTasksServiceProvider($application))->register();

        self::assertIsArray($config->get('seampact.tasks'));
    }

    public function testABootAfterTheGenerateCommandStillRefusesTheMismatch(): void
    {
        $_SERVER['argv'] = ['artisan', 'seampact:generate'];
        (new SkewedTasksServiceProvider(self::application()))->register();

        $_SERVER['argv'] = ['artisan', 'route:list'];
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage(RuntimeVersion::GENERATED_FOR_OTHER_VERSION);
        (new SkewedTasksServiceProvider(self::application()))->register();
    }

    private static function application(): Application
    {
        $application = new Application(sys_get_temp_dir());
        $application->instance('config', new Repository(['seampact' => []]));

        return $application;
    }
}
