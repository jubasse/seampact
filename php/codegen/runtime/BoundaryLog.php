<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The boundary's own log lines, written to the app's PSR-3 logger, and the unexpected-error listener: a line carries
 * the api, the operation, the reason and a pointer, never an input value; in the framework's debug mode only, it also
 * names the exception's message and `file:line` (`DebugLookup`). A pointer can hold client text, so a
 * logged pointer is cut to `MAX_LOGGED_POINTER_BYTES` on a UTF-8 boundary, with its control characters escaped.
 */
final class BoundaryLog
{
    public const MAX_LOGGED_POINTER_BYTES = 256;

    private function __construct()
    {
    }

    public static function unexpected(HookLookup $hooks, ApiContract $contract, ?string $operationId, string $reason, ?\Throwable $cause): void
    {
        $logger = $hooks->logger();
        $operation = $operationId ?? '-';
        $failure = $cause === null ? '' : ' (' . self::failure($hooks, $cause) . ')';
        $logger->error("seampact: api '{$contract->api}' operation '{$operation}': {$reason}{$failure}");

        // The 500 is written whatever the listener is: an unusable one is logged, never thrown from here.
        try {
            $listener = $hooks->unexpectedErrorListener($contract);
        } catch (\LogicException $unusable) {
            $logger->error("seampact: api '{$contract->api}' operation '{$operation}': the unexpected-error listener is unusable: {$unusable->getMessage()}");

            return;
        }

        $listener?->onUnexpectedError(new UnexpectedFailure($contract->api, $operationId, $reason, $cause));
    }

    public static function pointer(string $pointer): string
    {
        return self::escaped(mb_strcut($pointer, 0, self::MAX_LOGGED_POINTER_BYTES, 'UTF-8'));
    }

    /** Whether the app runs in its framework's debug mode, where an unmapped exception goes to the framework's error page. */
    public static function inDebug(HookLookup $hooks): bool
    {
        return $hooks instanceof DebugLookup && $hooks->isDebug();
    }

    // The exception class; in debug only, also its message and where it was thrown, which may hold an input value.
    private static function failure(HookLookup $hooks, \Throwable $cause): string
    {
        if (!self::inDebug($hooks)) {
            return $cause::class;
        }

        return $cause::class . ': ' . self::escaped($cause->getMessage()) . ' at ' . $cause->getFile() . ':' . $cause->getLine();
    }

    private static function escaped(string $text): string
    {
        return (string) preg_replace_callback('/[\x00-\x1f\x7f]/', static fn (array $control): string => sprintf('\\x%02x', ord($control[0])), $text);
    }
}
