<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;

/**
 * Finds the target of a Composer `use` among the installed packages (`vendor/composer/installed.json`): the package
 * of that name, its `extra.seampact.generator` class, which implements `Generator` and is built with no argument.
 * Each miss is refused by name, with the Node CLI's codes for a target package.
 */
final class TargetDiscovery
{
    private const INSTALLED_FILE = '/composer/installed.json';

    /** @var array<string, \stdClass> */
    private array $packages;

    /** @param array<string, \stdClass> $packages */
    private function __construct(array $packages)
    {
        $this->packages = $packages;
    }

    /** @throws \RuntimeException when `installed.json` is not readable JSON */
    public static function of(string $vendorDirectory): self
    {
        $file = $vendorDirectory . self::INSTALLED_FILE;
        $text = is_file($file) ? file_get_contents($file) : '{"packages": []}';
        if ($text === false) {
            throw new \RuntimeException("seampact: '{$file}' cannot be read; run `composer install` again.");
        }

        try {
            $installed = json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new \RuntimeException("seampact: '{$file}' is not JSON ({$error->getMessage()}); run `composer install` again.", 0, $error);
        }

        // Composer 2 writes `{ packages: [...] }`, Composer 1 a bare list.
        $list = $installed instanceof \stdClass ? $installed->packages ?? [] : $installed;
        $packages = [];
        foreach (is_array($list) ? $list : [] as $package) {
            if ($package instanceof \stdClass && is_string($package->name ?? null)) {
                $packages[$package->name] = $package;
            }
        }

        return new self($packages);
    }

    public function target(string $use, string $entryId): InstalledTarget|ConfigProblem
    {
        $where = "entry '{$entryId}' use";
        $package = $this->packages[$use] ?? null;
        if ($package === null) {
            return new ConfigProblem(
                'config.target.missing',
                "The target package '{$use}' is not installed.",
                "Install it with `composer require --dev {$use}`, or correct the entry's `use`.",
                $where,
            );
        }

        $extra = $package->extra ?? null;
        $seampact = $extra instanceof \stdClass ? $extra->seampact ?? null : null;
        $class = $seampact instanceof \stdClass ? $seampact->generator ?? null : null;
        if (!is_string($class) || $class === '') {
            return new ConfigProblem(
                'config.target.not-a-target',
                "The package '{$use}' is installed but is not a seampact target: its composer.json names no `extra.seampact.generator`.",
                'Name a seampact target package in `use`, such as seampact/laravel or seampact/symfony.',
                $where,
            );
        }

        $generator = self::generatorOf($class);
        if (is_string($generator)) {
            return new ConfigProblem(
                'config.target.load-failed',
                "The generator '{$class}' of the package '{$use}' cannot be loaded: {$generator}.",
                "Run `composer dump-autoload`, or update '{$use}' to a release whose generator implements " . Generator::class . '.',
                $where,
            );
        }

        $version = $package->version ?? null;

        return new InstalledTarget($use, is_string($version) ? $version : 'unknown', $generator);
    }

    /** @return Generator|string the generator, or why it cannot be built */
    private static function generatorOf(string $class): Generator|string
    {
        if (!class_exists($class)) {
            return 'no class of that name is autoloaded';
        }

        if (!is_subclass_of($class, Generator::class)) {
            return 'it does not implement ' . Generator::class;
        }

        $reflection = new \ReflectionClass($class);
        $constructor = $reflection->getConstructor();
        if (!$reflection->isInstantiable() || ($constructor !== null && $constructor->getNumberOfRequiredParameters() > 0)) {
            return 'it cannot be built with no argument';
        }

        return $reflection->newInstance();
    }
}
