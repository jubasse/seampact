<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\Method;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;

/**
 * The PHP types of the IR's type uses (ADR 0023 "Types and validation"): `DateTimeImmutable` for a `date-time`, `int`
 * for an integer, a backed enum, a readonly class per object, `array` with a `list<T>` PHPDoc; `?T` for an optional or
 * a nullable member, and `seampact/hooks`'s `Field` for one both optional and nullable.
 */
final class PhpTypes
{
    public const FIELD_CLASS = 'Seampact\\Hooks\\Field';
    public const DATE_TIME_FORMAT = 'date-time';
    private const DATE_TIME_CLASS = 'DateTimeImmutable';

    public function __construct(private readonly TypeNames $names)
    {
    }

    public function of(TypeUse $type, PhpClassFile $file): PhpType
    {
        $plain = $this->plain($type, $file);
        $nullable = match (true) {
            $type instanceof ScalarTypeUse, $type instanceof EnumTypeUse, $type instanceof RefTypeUse, $type instanceof ArrayTypeUse => $type->nullable === true,
            default => false,
        };

        return $nullable ? self::orNull($plain) : $plain;
    }

    /** The type of an object member: `?T` when optional or nullable, `Field<T>` when both. */
    public function member(TypeUse $type, bool $optional, bool $nullable, PhpClassFile $file): PhpType
    {
        $plain = $this->of($type, $file);

        if ($optional && $nullable) {
            $field = $file->name(self::FIELD_CLASS);

            return new PhpType(self::FIELD_CLASS, "{$field}<" . self::withoutNull($plain)->doc . '>');
        }

        return $optional || $nullable ? self::orNull($plain) : $plain;
    }

    /** Adds `$type` as a promoted constructor parameter, with its PHPDoc line when the native type says less. */
    public static function promote(Method $constructor, string $name, PhpType $type): void
    {
        $constructor->addPromotedParameter($name)->setType($type->native)->setNullable($type->nullable);

        if ($type->needsDoc()) {
            $constructor->addComment("@param {$type->doc} \${$name}");
        }
    }

    private function plain(TypeUse $type, PhpClassFile $file): PhpType
    {
        if ($type instanceof ArrayTypeUse) {
            $items = $this->of($type->items, $file);

            return new PhpType('array', 'list<' . $items->doc . '>');
        }

        $className = match (true) {
            $type instanceof EnumTypeUse => $this->names->enumClass($type->enum),
            $type instanceof RefTypeUse => $this->names->schemaClass($type->schema),
            $type instanceof ScalarTypeUse && $type->format === self::DATE_TIME_FORMAT => self::DATE_TIME_CLASS,
            default => null,
        };

        if ($className !== null) {
            return new PhpType($className, $file->name($className));
        }

        if (!$type instanceof ScalarTypeUse) {
            throw new \LogicException("The {$type->tag()} type use was kept but has no PHP type.");
        }

        $scalar = match ($type->type->value) {
            ScalarType::String => 'string',
            ScalarType::Integer => 'int',
            ScalarType::Number => 'float',
            ScalarType::Boolean => 'bool',
            default => throw new \LogicException("The scalar type '{$type->type->value}' was kept but has no PHP type."),
        };

        return new PhpType($scalar, $scalar);
    }

    private static function orNull(PhpType $type): PhpType
    {
        if ($type->nullable) {
            return $type;
        }

        $doc = str_contains($type->doc, '<') ? "{$type->doc}|null" : "?{$type->doc}";

        return new PhpType($type->native, $doc, true);
    }

    private static function withoutNull(PhpType $type): PhpType
    {
        $doc = str_starts_with($type->doc, '?') ? substr($type->doc, 1) : preg_replace('/\|null$/D', '', $type->doc);

        return new PhpType($type->native, (string) $doc);
    }
}
