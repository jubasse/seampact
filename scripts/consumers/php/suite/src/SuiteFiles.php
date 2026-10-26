<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/** The two files the suite doubles read, given by the app at boot since the framework knows where they live. */
final class SuiteFiles
{
    private static ?string $controlStatePath = null;
    private static ?string $credentialsPath = null;

    private function __construct()
    {
    }

    public static function configure(string $controlStatePath, string $credentialsPath): void
    {
        self::$controlStatePath = $controlStatePath;
        self::$credentialsPath = $credentialsPath;
    }

    public static function controlStatePath(): string
    {
        return self::$controlStatePath ?? throw new \LogicException('SuiteFiles::configure() was not called before the suite doubles ran.');
    }

    public static function credentialsPath(): string
    {
        return self::$credentialsPath ?? throw new \LogicException('SuiteFiles::configure() was not called before the suite doubles ran.');
    }
}
