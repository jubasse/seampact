<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\RouteTable;

/** The `config/seampact/<api>.php` an app publishes once: a later change of the entry's options still reaches it. */
final class PublishedConfigTest extends TestCase
{
    private const NAMESPACE = 'App\\Generated';

    public function testThePublishedFileDoesNotFreezeTheOptionsItWasGeneratedWith(): void
    {
        $withDefaults = self::configFile([]);
        $withChangedOptions = self::configFile(['responses' => 'warn', 'bodyValidation' => true, 'frameworkEtag' => 'keep', 'catchAll' => false]);

        self::assertSame($withDefaults, $withChangedOptions, 'A published config file would shadow the regenerated options with the old ones.');
    }

    /** @param array<string, mixed> $options */
    private static function configFile(array $options): string
    {
        $generator = new LaravelGenerator();
        $files = $generator->generate(ReferenceContract::core(new LaravelGenerator()), ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', self::NAMESPACE, $options));
        $config = array_values(array_filter($files, static fn (GeneratedFile $file): bool => $file->path === RouteTable::CONFIG_FILE));

        return $config === [] ? self::fail('The generation wrote no ' . RouteTable::CONFIG_FILE . '.') : $config[0]->contents;
    }
}
