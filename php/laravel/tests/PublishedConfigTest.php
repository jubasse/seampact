<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Laravel\TasksSeampactServiceProvider;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\RouteTable;

/**
 * The `config/seampact/<api>.php` an app publishes once: a later change of the entry's options still reaches it, and
 * its environment variables are read before it is published.
 */
final class PublishedConfigTest extends TestCase
{
    private const NAMESPACE = 'App\\Generated';
    private const RESPONSES_VARIABLE = 'SEAMPACT_TASKS_RESPONSES';

    public function testThePublishedFileDoesNotFreezeTheOptionsItWasGeneratedWith(): void
    {
        $withDefaults = self::configFile([]);
        $withChangedOptions = self::configFile(['responses' => 'warn', 'bodyValidation' => true, 'frameworkEtag' => 'keep', 'catchAll' => false]);

        self::assertSame($withDefaults, $withChangedOptions, 'A published config file would shadow the regenerated options with the old ones.');
    }

    public function testAnEnvironmentVariableIsReadWithoutPublishingTheFile(): void
    {
        self::setVariable(self::RESPONSES_VARIABLE, 'warn');
        try {
            $app = new Application(sys_get_temp_dir());
            $config = new Repository();
            $app->instance('config', $config);
            (new TasksSeampactServiceProvider($app))->register();
        } finally {
            self::setVariable(self::RESPONSES_VARIABLE, null);
        }

        self::assertSame('warn', $config->get('seampact.tasks.responses'));
        self::assertSame('strip', $config->get('seampact.tasks.framework_etag'));
    }

    public function testTheAppsOwnConfigWinsOverTheEnvironment(): void
    {
        self::setVariable(self::RESPONSES_VARIABLE, 'warn');
        try {
            $app = new Application(sys_get_temp_dir());
            $config = new Repository(['seampact' => ['tasks' => ['responses' => 'strict']]]);
            $app->instance('config', $config);
            (new TasksSeampactServiceProvider($app))->register();
        } finally {
            self::setVariable(self::RESPONSES_VARIABLE, null);
        }

        self::assertSame('strict', $config->get('seampact.tasks.responses'));
    }

    private static function setVariable(string $name, ?string $value): void
    {
        putenv($value === null ? $name : "{$name}={$value}");
        if ($value === null) {
            unset($_ENV[$name], $_SERVER[$name]);

            return;
        }
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
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
