<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Seampact\Hooks\Field;

/**
 * Turns the decoded wire tree into the generated PHP values and back, by the IR's type uses and the classes the
 * generator wrote for each schema and enum: objects as their readonly classes, enums as backed enums, `date-time` as
 * `DateTimeImmutable` with the offset it was sent with, a member both optional and nullable as `Field`.
 */
final class WireCodec
{
    private const DATE_TIME = 'date-time';
    public const DATE_TIME_WIRE = 'Y-m-d\TH:i:s.vP';
    private const OPAQUE = 'opaque';

    private function __construct()
    {
    }

    /** A value the step 6 rules accepted, as its generated PHP type. */
    public static function decode(ApiContract $contract, mixed $type, mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        return match (Ir::string($type, 'kind')) {
            'scalar' => self::decodeScalar($type, $value),
            'enum' => self::enumClass($contract, Ir::string($type, 'enum') ?? '')::from(is_int($value) ? $value : (is_string($value) ? $value : '')),
            'ref' => self::decodeObject($contract, Ir::string($type, 'schema') ?? '', $value),
            'array' => array_map(static fn (mixed $item): mixed => self::decode($contract, Ir::map($type, 'items'), $item), is_array($value) ? array_values($value) : []),
            // An opaque value is handed over as the JSON decode wrote it, objects as `stdClass`.
            self::OPAQUE => $value,
            default => throw new \LogicException('seampact: the type kind ' . var_export(Ir::string($type, 'kind'), true) . ' is not one the boundary decodes.'),
        };
    }

    /**
     * Named constructor arguments of a generated class from wire members: `$members` maps each wire name to its PHP
     * property, `$declared` lists the IR members with their type, optional and nullable flags.
     *
     * @param array<array-key, mixed> $members
     * @param list<array<array-key, mixed>> $declared
     * @return array<string, mixed>
     */
    public static function arguments(ApiContract $contract, array $members, array $declared, \stdClass $values): array
    {
        $present = get_object_vars($values);
        $arguments = [];
        foreach ($declared as $member) {
            $wireName = Ir::string($member, 'name') ?? '';
            $property = Ir::string($members, $wireName);
            if ($property === null) {
                continue;
            }

            $sent = array_key_exists($wireName, $present);
            $value = $sent ? self::decode($contract, $member['type'] ?? null, $present[$wireName]) : null;
            $arguments[$property] = Ir::true($member, 'optional') && Ir::true($member, 'nullable')
                ? (!$sent ? Field::absent() : ($value === null ? Field::ofNull() : Field::of($value)))
                : $value;
        }

        return $arguments;
    }

    /**
     * A generated PHP value as the wire writes it: objects as `stdClass`, lists as arrays. An opaque value is typed
     * `mixed`, so its `null` is checked here: it is written only where the contract makes the value nullable.
     */
    public static function encode(ApiContract $contract, mixed $type, mixed $value): mixed
    {
        if ($value === null) {
            if (Ir::string($type, 'kind') === self::OPAQUE && !Ir::true($type, 'nullable')) {
                throw new BoundaryFailure(new \LogicException("seampact: the handler wrote null for an opaque value the contract does not make nullable; return a JSON value, or declare it 'nullable: true'."));
            }

            return null;
        }

        return match (Ir::string($type, 'kind')) {
            'scalar' => $value instanceof \DateTimeInterface ? $value->format(self::DATE_TIME_WIRE) : $value,
            'enum' => $value instanceof \BackedEnum ? $value->value : $value,
            'ref' => is_object($value) ? self::encodeObject($contract, Ir::string($type, 'schema') ?? '', $value) : $value,
            'array' => array_map(static fn (mixed $item): mixed => self::encode($contract, Ir::map($type, 'items'), $item), is_array($value) ? array_values($value) : []),
            self::OPAQUE => $value,
            default => throw new \LogicException('seampact: the type kind ' . var_export(Ir::string($type, 'kind'), true) . ' is not one the boundary encodes.'),
        };
    }

    /**
     * A response body as the wire writes it: a table's values keyed as the handler keyed them.
     *
     * @param array<array-key, mixed> $response
     */
    public static function encodeBody(ApiContract $contract, array $response, mixed $body): mixed
    {
        $shape = Ir::string($response, 'shape');
        if ($shape === 'list' || $shape === 'page') {
            return array_map(static fn (mixed $item): mixed => self::encode($contract, $response['body'] ?? null, $item), is_array($body) ? array_values($body) : []);
        }
        if ($shape !== 'table') {
            return self::encode($contract, $response['body'] ?? null, $body);
        }

        $table = new \stdClass();
        foreach (is_array($body) ? $body : [] as $key => $value) {
            $table->{(string) $key} = self::encode($contract, $response['body'] ?? null, $value);
        }

        return $table;
    }

    private static function decodeScalar(mixed $type, mixed $value): mixed
    {
        return match (true) {
            Ir::string($type, 'format') === self::DATE_TIME && is_string($value) => new \DateTimeImmutable($value),
            Ir::string($type, 'type') === 'integer' && is_float($value) => (int) $value,
            Ir::string($type, 'type') === 'number' && is_int($value) => (float) $value,
            default => $value,
        };
    }

    private static function decodeObject(ApiContract $contract, string $schemaId, mixed $value): object
    {
        [$class, $members] = self::schemaClass($contract, $schemaId);
        $declared = Ir::maps($contract->declaration('schemas', $schemaId), 'properties');

        return new $class(...self::arguments($contract, $members, $declared, $value instanceof \stdClass ? $value : new \stdClass()));
    }

    private static function encodeObject(ApiContract $contract, string $schemaId, object $value): \stdClass
    {
        [, $members] = self::schemaClass($contract, $schemaId);
        $properties = get_object_vars($value);
        $encoded = new \stdClass();
        foreach (Ir::maps($contract->declaration('schemas', $schemaId), 'properties') as $member) {
            $wireName = Ir::string($member, 'name') ?? '';
            $property = Ir::string($members, $wireName);
            $held = $property === null ? null : ($properties[$property] ?? null);
            if ($held instanceof Field) {
                if ($held->isAbsent()) {
                    continue;
                }
                $held = $held->isNull() ? null : $held->value();
            } elseif ($held === null && Ir::true($member, 'optional')) {
                continue;
            }
            $encoded->{$wireName} = $held === null && Ir::true($member, 'nullable') ? null : self::encode($contract, $member['type'] ?? null, $held);
        }

        return $encoded;
    }

    /** @return array{class-string, array<array-key, mixed>} */
    private static function schemaClass(ApiContract $contract, string $schemaId): array
    {
        $entry = Ir::map(Ir::map($contract->types, 'schemas'), $schemaId);
        $class = Ir::string($entry, 'class');
        if ($class === null || !class_exists($class)) {
            throw new \LogicException("seampact: no generated class for the schema '{$schemaId}'; regenerate the api.");
        }

        return [$class, Ir::map($entry, 'members')];
    }

    /** @return class-string<\BackedEnum> */
    private static function enumClass(ApiContract $contract, string $enumId): string
    {
        $class = Ir::string(Ir::map($contract->types, 'enums'), $enumId);
        if ($class === null || !is_subclass_of($class, \BackedEnum::class)) {
            throw new \LogicException("seampact: no generated enum for '{$enumId}'; regenerate the api.");
        }

        return $class;
    }
}
