<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The refusals of the compiler binary channel of a PHP build (ADR 0010, "Amendment 2026-10-26: the PHP
 * channels"), and `php.unpatched`, the runtime check that runs before any seampact work.
 */
enum BinaryFailureCode: string
{
    case Unpublished = 'binary.unpublished';
    case PinMissing = 'binary.pin-missing';
    case PinInvalid = 'binary.pin-invalid';
    case HashMismatch = 'binary.hash-mismatch';
    case OverrideNotRoot = 'binary.override-not-root';
    case PlatformUnsupported = 'binary.platform-unsupported';
    case CacheUnavailable = 'binary.cache-unavailable';
    case CacheUnsafe = 'binary.cache-unsafe';
    case CompileTimeout = 'binary.compile-timeout';
    case CompileFailed = 'binary.compile-failed';
    case PhpUnpatched = 'php.unpatched';
}
