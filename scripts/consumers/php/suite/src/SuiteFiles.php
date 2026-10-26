<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/**
 * The files the suite doubles read and write, given by the app at boot since the framework knows where they live; the
 * idempotency store's file sits beside the control state.
 */
final class SuiteFiles
{
    private const IDEMPOTENCY_STORE_FILE = 'suite-idempotency.json';

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

    public static function idempotencyStorePath(): string
    {
        return dirname(self::controlStatePath()) . '/' . self::IDEMPOTENCY_STORE_FILE;
    }
}
