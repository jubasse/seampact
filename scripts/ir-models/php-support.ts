// The fixed PHP classes the generated model needs beside the definitions: the hydration and encoding helpers, the
// exception, the optional-opaque wrapper and the shape type of the must-act walk. They hold no schema content, so
// they are written once here; the emitter prefixes each with the generated-file header.

const EXCEPTION = String.raw`/** The JSON does not have the shape of the IR model: the message names the definition and member, never a value. */
final class IrModelException extends \InvalidArgumentException
{
}
`;

const OPAQUE = `/**
 * An optional opaque member that is present. An absent member is null instead, so that a JSON null value
 * (new IrOpaque(null)) stays apart from an absent member.
 */
final readonly class IrOpaque
{
    private mixed $value;

    public function __construct(mixed $value)
    {
        $this->value = IrHydration::copy($value);
    }

    /** A copy: the kept value cannot be changed through it. */
    public function value(): mixed
    {
        return IrHydration::copy($this->value);
    }
}
`;

const SHAPE = `/**
 * The shape of the IR the reader walks on the raw JSON to find an unknown tag or value of a must-act definition
 * (ADR 0005 section 3): a definition by name, a struct's walked members, a tagged union, an open enum, an array
 * or a map. A member that holds no definition is not listed.
 */
final readonly class IrShape
{
    public const NAMED = 'named';
    public const STRUCT = 'struct';
    public const UNION = 'union';
    public const OPEN_ENUM = 'openEnum';
    public const ITEMS = 'items';
    public const VALUES = 'values';

    /**
     * @param array<string, IrShape> $members the walked members of a struct
     * @param array<string, string> $variants the definition of each tag value of a union
     * @param list<string> $known the known values of an open enum
     */
    private function __construct(
        public string $kind,
        public ?string $definition = null,
        public array $members = [],
        public ?string $tag = null,
        public bool $mustAct = false,
        public array $variants = [],
        public array $known = [],
        public ?IrShape $of = null,
    ) {
    }

    public static function named(string $definition): self
    {
        return new self(self::NAMED, definition: $definition);
    }

    /** @param array<string, IrShape> $members */
    public static function struct(array $members): self
    {
        return new self(self::STRUCT, members: $members);
    }

    /** @param array<string, string> $variants */
    public static function union(string $tag, bool $mustAct, array $variants): self
    {
        return new self(self::UNION, tag: $tag, mustAct: $mustAct, variants: $variants);
    }

    /** @param list<string> $known */
    public static function openEnum(array $known, bool $mustAct): self
    {
        return new self(self::OPEN_ENUM, mustAct: $mustAct, known: $known);
    }

    public static function items(IrShape $of): self
    {
        return new self(self::ITEMS, of: $of);
    }

    public static function values(IrShape $of): self
    {
        return new self(self::VALUES, of: $of);
    }
}
`;

const HYDRATION = String.raw`/**
 * Reads the output of json_decode($text) (objects as stdClass, no associative mode) into the model and writes
 * the model back as data json_encode turns into the same document. A map is a PHP array whose keys are strings
 * in the document but integers in PHP when they look like one ("1042"): read a key with (string) $key. The
 * encoder writes every key back as a string, and an empty map as {}.
 *
 * Every message names the definition and member and the JSON type found, never the value.
 */
final class IrHydration
{
    /** The largest IR integer, 2^53 - 1: IR integers are in the safe range of I-JSON (RFC 7493). */
    private const MAX_SAFE_INTEGER = 9007199254740991;

    public static function jsonType(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => 'boolean',
            is_int($value), is_float($value) => 'number',
            is_string($value) => 'string',
            is_array($value) => 'array',
            default => 'object',
        };
    }

    public static function object(mixed $value, string $at): \stdClass
    {
        if ($value instanceof \stdClass) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a JSON object, got the JSON type %s', $at, self::jsonType($value)));
    }

    /** A deep copy of decoded JSON, so that the model never shares a value with its caller. */
    public static function copy(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            return self::copyObject($value);
        }

        return is_array($value) ? array_map(self::copy(...), $value) : $value;
    }

    public static function copyObject(\stdClass $value): \stdClass
    {
        $copy = new \stdClass();
        foreach (get_object_vars($value) as $name => $member) {
            $copy->{(string) $name} = self::copy($member);
        }

        return $copy;
    }

    public static function string(mixed $value, string $at): string
    {
        if (is_string($value)) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a string, got the JSON type %s', $at, self::jsonType($value)));
    }

    public static function boolean(mixed $value, string $at): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a boolean, got the JSON type %s', $at, self::jsonType($value)));
    }

    /** An IR integer from -(2^53 - 1) to 2^53 - 1: a JSON integer, or a number written with a fraction of zero ('2.0'). */
    public static function integer(mixed $value, string $at): int
    {
        if (!is_int($value) && !is_float($value)) {
            throw new IrModelException(sprintf('%s: expected an integer, got the JSON type %s', $at, self::jsonType($value)));
        }
        if ((is_float($value) && floor($value) !== $value) || abs($value) > self::MAX_SAFE_INTEGER) {
            throw new IrModelException(sprintf('%s: expected an integer from -(2^53 - 1) to 2^53 - 1', $at));
        }

        return (int) $value;
    }

    public static function required(\stdClass $members, string $name, string $at): mixed
    {
        if (!property_exists($members, $name)) {
            throw new IrModelException(sprintf("%s: the member '%s' is missing", $at, $name));
        }

        return $members->{$name};
    }

    /**
     * An optional member: absent and a JSON null are both null.
     *
     * @template T
     * @param callable(mixed): T $hydrate
     * @return T|null
     */
    public static function optional(\stdClass $members, string $name, callable $hydrate): mixed
    {
        if (!property_exists($members, $name) || $members->{$name} === null) {
            return null;
        }

        return $hydrate($members->{$name});
    }

    /** An optional opaque member: absent is 'null', a JSON 'null' is 'IrOpaque(null)'. */
    public static function optionalOpaque(\stdClass $members, string $name): ?IrOpaque
    {
        return property_exists($members, $name) ? new IrOpaque($members->{$name}) : null;
    }

    /** The tag of a union object: a string member, or an error naming the union. */
    public static function unionTag(\stdClass $members, string $name, string $at): string
    {
        $tag = $members->{$name} ?? null;
        if (!is_string($tag)) {
            throw new IrModelException(sprintf("%s: the tag member '%s' is missing or not a string", $at, $name));
        }

        return $tag;
    }

    /** A variant read on its own must carry its own tag. */
    public static function tag(\stdClass $members, string $name, string $expected, string $at): void
    {
        if (self::unionTag($members, $name, $at) !== $expected) {
            throw new IrModelException(sprintf("%s: the tag member '%s' is not '%s'", $at, $name, $expected));
        }
    }

    /**
     * @template T
     * @param callable(mixed): T $hydrate
     * @return list<T>
     */
    public static function listOf(mixed $value, string $at, callable $hydrate): array
    {
        if (!is_array($value)) {
            throw new IrModelException(sprintf('%s: expected a JSON array, got the JSON type %s', $at, self::jsonType($value)));
        }

        $items = [];
        foreach ($value as $item) {
            $items[] = $hydrate($item);
        }

        return $items;
    }

    /**
     * @template T
     * @param callable(mixed): T $hydrate
     * @return array<int|string, T>
     */
    public static function mapOf(mixed $value, string $at, callable $hydrate): array
    {
        return array_map($hydrate, get_object_vars(self::object($value, $at)));
    }

    /**
     * @template T
     * @param list<T> $items
     * @param callable(T): mixed $encode
     * @return list<mixed>
     */
    public static function encodeList(array $items, callable $encode): array
    {
        return array_map($encode, $items);
    }

    /**
     * A map as an object, so that an empty map is {} and a key like 1042 stays a string.
     *
     * @template T
     * @param array<int|string, T> $map
     * @param (callable(T): mixed)|null $encode
     */
    public static function encodeMap(array $map, ?callable $encode = null): \stdClass
    {
        $json = new \stdClass();
        foreach ($map as $key => $item) {
            $json->{(string) $key} = $encode === null ? $item : $encode($item);
        }

        return $json;
    }
}
`;

/** The class name and body (without the file header) of each fixed support file. */
export const PHP_SUPPORT_FILES: readonly (readonly [string, string])[] = [
  ["IrHydration", HYDRATION],
  ["IrModelException", EXCEPTION],
  ["IrOpaque", OPAQUE],
  ["IrShape", SHAPE],
];
