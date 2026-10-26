<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Http\Request;

/**
 * The input of one contract request as the boundary decoded it: the path, query and header values by wire name, and
 * the body with its objects preserved, so `{}` and `[]` stay apart. The generated rules read their values here and
 * record the contract issues they find. Laravel's validator reads `.` and `*` in a data key as path syntax, so a wire
 * name is escaped in the validation data and the rule keys (`~` as `~0`, `.` as `~1`, `*` as `~2`).
 */
final class InputTree
{
    private const PARTS = ['path', 'query', 'headers', 'body'];
    private const SEPARATOR = '.';
    private const ESCAPES = ['~' => '~0', '.' => '~1', '*' => '~2'];
    private const UNESCAPES = ['~1' => '.', '~2' => '*', '~0' => '~'];
    private const HEADERS_PART = 'headers';
    private const HEADER_ISSUE_PART = 'header';

    /** @var list<ContractIssue> */
    private array $issues = [];

    private function __construct(private readonly \stdClass $root)
    {
    }

    /**
     * @param array<string, mixed> $path
     * @param array<string, mixed> $query
     * @param array<string, mixed> $headers
     */
    public static function withoutBody(array $path, array $query, array $headers): self
    {
        return new self((object) ['path' => (object) $path, 'query' => (object) $query, 'headers' => (object) $headers]);
    }

    /**
     * @param array<string, mixed> $path
     * @param array<string, mixed> $query
     * @param array<string, mixed> $headers
     * @param mixed $body the body decoded with its objects preserved (`json_decode($bytes, false)`)
     */
    public static function withBody(array $path, array $query, array $headers, mixed $body): self
    {
        return new self((object) ['path' => (object) $path, 'query' => (object) $query, 'headers' => (object) $headers, 'body' => $body]);
    }

    public static function attributeName(string $api): string
    {
        return "seampact.{$api}.input";
    }

    /** @throws ContractBypassedException the boundary middleware stored no input on `$request` */
    public static function of(Request $request, string $api): self
    {
        $tree = $request->attributes->get(self::attributeName($api));

        if (!$tree instanceof self) {
            throw new ContractBypassedException(
                "A contract FormRequest of api '{$api}' ran without the input the boundary middleware decodes. "
                . 'Serve the operation only through its generated route, with the boundary middleware installed.',
            );
        }

        return $tree;
    }

    public static function escape(string $wireName): string
    {
        return strtr($wireName, self::ESCAPES);
    }

    /** What the input holds at a rule key's attribute, such as `body.tags.3`. */
    public function lookup(string $attribute, Position $position): Lookup
    {
        $segments = array_map(static fn (string $segment): string => strtr($segment, self::UNESCAPES), explode(self::SEPARATOR, $attribute));
        $last = array_pop($segments);
        $container = $this->root;

        foreach ($segments as $segment) {
            $step = self::child($container, $segment);
            if (!$step->isPresent()) {
                return Lookup::unreachable();
            }
            $container = $step->value;
        }

        if ($position === Position::Item) {
            return is_array($container) && array_is_list($container) ? self::child($container, $last) : Lookup::unreachable();
        }

        return $container instanceof \stdClass ? self::child($container, $last) : Lookup::unreachable();
    }

    /**
     * Laravel's validation data: each part as arrays, every wire name escaped.
     *
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        $data = [];

        foreach (self::PARTS as $part) {
            if (property_exists($this->root, $part)) {
                $data[$part] = self::asArrays($this->root->{$part});
            }
        }

        return $data;
    }

    public function record(string $attribute, string $contractRule): void
    {
        $segments = explode(self::SEPARATOR, $attribute);
        $part = array_shift($segments);
        $pointer = implode('', array_map(
            static fn (string $segment): string => '/' . str_replace(['~', '/'], ['~0', '~1'], strtr($segment, self::UNESCAPES)),
            $segments,
        ));

        $this->issues[] = new ContractIssue($part === self::HEADERS_PART ? self::HEADER_ISSUE_PART : $part, $pointer, $contractRule);
    }

    /** @return list<ContractIssue> */
    public function issues(): array
    {
        return $this->issues;
    }

    private static function child(mixed $container, string $key): Lookup
    {
        if ($container instanceof \stdClass) {
            $members = get_object_vars($container);

            return array_key_exists($key, $members) ? Lookup::present($members[$key]) : Lookup::absent();
        }

        if (is_array($container) && ctype_digit($key) && array_key_exists((int) $key, $container)) {
            return Lookup::present($container[(int) $key]);
        }

        return Lookup::unreachable();
    }

    private static function asArrays(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $members = [];
            foreach (get_object_vars($value) as $key => $member) {
                $members[self::escape((string) $key)] = self::asArrays($member);
            }

            return $members;
        }

        return is_array($value) ? array_map(self::asArrays(...), $value) : $value;
    }
}
