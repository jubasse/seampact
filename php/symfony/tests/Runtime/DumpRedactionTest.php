<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\AuthenticateCall;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\DumpRedaction;
use Seampact\Golden\TasksConsistent\Symfony\UserCredentials;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\RequestView;
use Symfony\Component\VarDumper\Cloner\VarCloner;
use Symfony\Component\VarDumper\Dumper\CliDumper;

final class DumpRedactionTest extends TestCase
{
    private const SECRET = 'bearer-secret-7f3a';

    public function testVarDumperShowsTheGeneratedCredentialsRedactedOnceRegistered(): void
    {
        $credentials = new UserCredentials(self::SECRET, null);
        self::assertStringContainsString(self::SECRET, self::dumped($credentials), 'VarDumper reads properties, so without the caster it prints the secret.');

        DumpRedaction::register(ApiContract::of(TasksContract::class));
        $dumped = self::dumped($credentials);

        self::assertStringNotContainsString(self::SECRET, $dumped);
        self::assertStringContainsString('[redacted]', $dumped);
    }

    public function testVarDumperShowsTheAuthenticateHookCallRedactedOnceRegistered(): void
    {
        $call = new AuthenticateCall('user', new UserCredentials(self::SECRET, null), self::SECRET, new RequestView('GET', '/v1/tasks', []), new OperationRef('tasks', 'getTask'));

        DumpRedaction::register(ApiContract::of(TasksContract::class));
        $dumped = self::dumped($call);

        self::assertStringNotContainsString(self::SECRET, $dumped);
        self::assertStringContainsString('[redacted]', $dumped);
    }

    private static function dumped(object $value): string
    {
        $output = (new CliDumper())->dump((new VarCloner())->cloneVar($value), true);

        return is_string($output) ? $output : '';
    }
}
