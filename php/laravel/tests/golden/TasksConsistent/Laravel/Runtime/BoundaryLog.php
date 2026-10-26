<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Container\Container;
use Psr\Log\LoggerInterface;

/**
 * The boundary's own log lines, written to the app's PSR-3 logger, and the unexpected-error listener: a line carries
 * the api, the operation, the reason and a pointer, never an input value. A pointer can hold client text, so a
 * logged pointer is cut to `MAX_LOGGED_POINTER_BYTES` on a UTF-8 boundary, with its control characters escaped.
 */
final class BoundaryLog
{
    public const MAX_LOGGED_POINTER_BYTES = 256;

    private function __construct()
    {
    }

    public static function unexpected(ApiContract $contract, ?string $operationId, string $reason, ?\Throwable $cause, string $listenerInterface): void
    {
        $container = Container::getInstance();
        $logger = $container->make(LoggerInterface::class);
        $operation = $operationId ?? '-';
        $failure = $cause === null ? '' : ' (' . $cause::class . ')';
        $logger->error("seampact: api '{$contract->api}' operation '{$operation}': {$reason}{$failure}");

        Hooks::unexpectedErrorListener($container, $listenerInterface)?->onUnexpectedError(new UnexpectedFailure($contract->api, $operationId, $reason, $cause));
    }

    public static function pointer(string $pointer): string
    {
        $cut = mb_strcut($pointer, 0, self::MAX_LOGGED_POINTER_BYTES, 'UTF-8');

        return (string) preg_replace_callback('/[\x00-\x1f\x7f]/', static fn (array $control): string => sprintf('\\x%02x', ord($control[0])), $cut);
    }
}
