<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Psr\Log\AbstractLogger;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryLog;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;

/** The boundary's 500 path logs its failure even when the app's unexpected-error listener cannot be used. */
final class BoundaryLogTest extends TestCase
{
    public function testAnUnusableListenerIsLoggedAndTheFailureStillLogged(): void
    {
        $logger = new class () extends AbstractLogger {
            /** @var list<string> */
            public array $lines = [];

            public function log($level, \Stringable|string $message, array $context = []): void
            {
                $this->lines[] = (string) $message;
            }
        };

        BoundaryLog::unexpected(self::lookup($logger), ApiContract::of(SelectionContract::class), 'getTask', 'a boundary step failed', null);

        self::assertCount(2, $logger->lines);
        self::assertStringContainsString('a boundary step failed', $logger->lines[0]);
        self::assertStringContainsString('the unexpected-error listener is unusable: bind it to a class implementing', $logger->lines[1]);
    }

    private static function lookup(LoggerInterface $logger): HookLookup
    {
        return new class ($logger) implements HookLookup {
            public function __construct(private readonly LoggerInterface $logger)
            {
            }

            public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
            {
                throw new \LogicException('not called by the log');
            }

            public function deciders(ApiContract $contract): iterable
            {
                return [];
            }

            public function scopeResolvers(ApiContract $contract): iterable
            {
                return [];
            }

            public function unexpectedErrorListener(): ?UnexpectedErrorListener
            {
                throw new \LogicException('bind it to a class implementing ' . UnexpectedErrorListener::class . '.');
            }

            public function logger(): LoggerInterface
            {
                return $this->logger;
            }

            public function isAccessDenial(\Throwable $failure): bool
            {
                return false;
            }
        };
    }
}
