<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\HandlerDeclaration;

/** A handler class implementing the golden endpoints interface: PHP refuses a return type its operation does not declare when the class loads. */
final class HandlerReturnTypeTest extends TestCase
{
    private const AUTOLOAD = __DIR__ . '/../vendor/autoload.php';

    private static function handler(string $returnType, string $body): string
    {
        return "final class HealthHandler implements \\Seampact\\Golden\\Tasks\\AppEndpoints {\n"
            . "    public function health(\\Seampact\\Golden\\Tasks\\HealthRequest \$request): $returnType { $body }\n"
            . '}';
    }

    public function testAHandlerReturningItsOperationsResultLoads(): void
    {
        $loaded = HandlerDeclaration::load(self::AUTOLOAD, self::handler('\\Seampact\\Golden\\Tasks\\HealthResult', 'throw new \\LogicException();'));

        self::assertTrue($loaded['succeeded'], $loaded['output']);
    }

    public function testAHandlerReturningAnotherTypeThanItsOperationsResultIsRefusedWhenTheClassLoads(): void
    {
        $loaded = HandlerDeclaration::load(self::AUTOLOAD, self::handler('string', "return 'ok';"));

        self::assertFalse($loaded['succeeded']);
        self::assertStringContainsString('must be compatible with', $loaded['output']);
    }

    public function testAHandlerReturningAnotherOperationsResultIsRefusedWhenTheClassLoads(): void
    {
        $loaded = HandlerDeclaration::load(self::AUTOLOAD, self::handler('\\Seampact\\Golden\\Tasks\\GetTaskResult', 'throw new \\LogicException();'));

        self::assertFalse($loaded['succeeded']);
        self::assertStringContainsString('must be compatible with', $loaded['output']);
    }
}
