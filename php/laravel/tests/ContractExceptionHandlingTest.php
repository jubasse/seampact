<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use Illuminate\Foundation\Exceptions\Handler;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Laravel\Runtime\ContractExceptionHandling;

/** A contract refusal is an answer, not a failure: Laravel's handler must never report it. */
final class ContractExceptionHandlingTest extends TestCase
{
    public function testTheHandlerDoesNotReportAContractRefusal(): void
    {
        $handler = new Handler(new Container());

        ContractExceptionHandling::register($handler, 'tasks');

        self::assertFalse($handler->shouldReport(new ContractRefusal('tasks', 'taskNotFound')));
        self::assertTrue($handler->shouldReport(new \RuntimeException('a handler failure')));
    }
}
