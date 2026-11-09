<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use ApiPlatform\Metadata\Get;
use ApiPlatform\State\ProcessorInterface;
use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\Runtime\ReplyDecorator;
use Symfony\Component\HttpFoundation\Request;

/** The decorator handles only its api's generated results (ADR 0029 "The reply path"); any other value reaches the inner processor. */
final class ReplyDecoratorTest extends TestCase
{
    public function testAValueThatIsNoGeneratedResultGoesToTheInnerProcessorUntouched(): void
    {
        $inner = new class implements ProcessorInterface {
            public function process(mixed $data, \ApiPlatform\Metadata\Operation $operation, array $uriVariables = [], array $context = []): mixed
            {
                return ['inner', $data, $uriVariables];
            }
        };
        $decorator = new class($inner) extends ReplyDecorator {
            protected function contractClass(): string
            {
                throw new \LogicException('The contract is read only for an object.');
            }

            protected function apiId(): string
            {
                return 'tasks';
            }
        };

        $context = ['request' => Request::create('/v1/tasks')];

        self::assertSame(['inner', null, ['id' => '1']], $decorator->process(null, new Get(), ['id' => '1'], $context));
        self::assertSame(['inner', 'text', []], $decorator->process('text', new Get(), [], []));
    }
}
