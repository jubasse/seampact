<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\ClassType;
use Nette\PhpGenerator\Method;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;

/**
 * The redaction of a generated class that holds a sensitive value (ADR 0023 "Redaction"): its constructor marks the
 * parameter `#[\SensitiveParameter]`, so a stack trace omits it, and a generated `__debugInfo()` prints it as the
 * `[redacted]` constant, so `var_dump`, `print_r` and the provider's VarDumper caster never show it.
 */
final class RedactedMembers
{
    public const REDACTED = '[redacted]';
    private const SENSITIVE_PARAMETER = 'SensitiveParameter';
    private const MIXED = 'mixed';

    private function __construct()
    {
    }

    /** Whether a value of `$type` is sensitive: a sensitive scalar, or a list of them. */
    public static function isSensitive(TypeUse $type): bool
    {
        return match (true) {
            $type instanceof ScalarTypeUse => $type->sensitive === true,
            $type instanceof ArrayTypeUse => self::isSensitive($type->items),
            default => false,
        };
    }

    /**
     * Redacts the promoted parameters `$sensitive` of `$constructor`; does nothing when the list is empty.
     *
     * @param list<string> $sensitive member names
     */
    public static function redact(ClassType $class, Method $constructor, array $sensitive): void
    {
        if ($sensitive === []) {
            return;
        }

        $lines = [];
        foreach ($constructor->getParameters() as $name => $parameter) {
            if (!in_array($name, $sensitive, true)) {
                $lines[] = "\t" . var_export($name, true) . " => \$this->{$name},";
                continue;
            }

            $parameter->addAttribute(self::SENSITIVE_PARAMETER);
            // An absent value stays visible as null; only a present one is hidden.
            $mayBeNull = $parameter->isNullable() || $parameter->getType() === self::MIXED;
            $lines[] = "\t" . var_export($name, true) . ' => ' . ($mayBeNull ? "\$this->{$name} === null ? null : self::REDACTED" : 'self::REDACTED') . ',';
        }

        $class->addConstant('REDACTED', self::REDACTED)->setPrivate();
        $class->addMethod('__debugInfo')->setReturnType('array')
            ->addComment('@return array<string, mixed> each sensitive member redacted, so a dump never shows it')
            ->setBody("return [\n" . implode("\n", $lines) . "\n];");
    }
}
