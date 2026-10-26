<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Symfony\Component\VarDumper\Cloner\AbstractCloner;

/**
 * Symfony VarDumper, behind `dump()` and `dd()`, reads an object's properties rather than its `__debugInfo()`: a caster
 * on each generated value class prints what `__debugInfo()` prints, so a sensitive member stays `[redacted]` there too
 * (ADR 0023 "Redaction"). Without VarDumper installed there is nothing to register.
 */
final class DumpRedaction
{
    /** The runtime and `seampact/hooks` classes whose `__debugInfo()` hides a credential, a body or a signature. */
    private const RUNTIME_HOLDERS = [
        AuthenticateCall::class,
        BoundaryState::class,
        RequirementCall::class,
        SignatureHeader::class,
        \Seampact\Hooks\RequestView::class,
        \Seampact\Hooks\SignedApplicationRequest::class,
        \Seampact\Hooks\SignedTemplateRequest::class,
        \Seampact\Hooks\StoredResponse::class,
        \Seampact\Hooks\StoredResponse\Header::class,
    ];

    private function __construct()
    {
    }

    public static function register(ApiContract $contract): void
    {
        if (!class_exists(AbstractCloner::class)) {
            return;
        }

        $caster = [self::class, 'cast'];
        foreach ([...$contract->valueClasses(), ...self::RUNTIME_HOLDERS] as $class) {
            AbstractCloner::$defaultCasters[$class] = $caster;
        }
    }

    /**
     * @param array<array-key, mixed> $properties the properties VarDumper read
     * @return array<array-key, mixed>
     */
    public static function cast(object $value, array $properties): array
    {
        if (!method_exists($value, '__debugInfo')) {
            return $properties;
        }
        $shown = $value->__debugInfo();

        return is_array($shown) ? $shown : $properties;
    }
}
