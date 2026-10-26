<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Step 6 on the decoded input (ADR 0024 "Types and validation"): an object with `path`, `query` and `header` objects
 * and, when a body was sent, `body`, decoded with objects preserved. Per member it reads presence with
 * `property_exists`, so an explicit null and an absent key never look alike, then the JSON type; only when the type
 * passes does it run the member's value checks and constraints. Each issue is a violation at the member's JSON
 * Pointer from the input's root (`/body/ids/0`), whose first token is the issue's `in`.
 */
final readonly class InputWalk
{
    private const PARTS = ['path', 'query', 'header'];

    public function __construct(private ExecutionContextInterface $context)
    {
    }

    public function input(mixed $input, InputShape $shape): void
    {
        if (!$input instanceof \stdClass) {
            throw new \LogicException('The contract input to validate is not the decoded input object; the boundary passes an object with path, query, header and body members.');
        }

        foreach (self::PARTS as $part) {
            $values = property_exists($input, $part) ? $input->{$part} : new \stdClass();
            if (!$values instanceof \stdClass) {
                throw new \LogicException("The decoded input's {$part} member is not an object; the boundary decodes each parameter part to an object.");
            }

            $keys = $part === 'query' ? $shape->unknownQuery : KeyPolicy::Keep;
            $this->members($values, $shape->{$part}, $keys, '/' . $part);
        }

        if ($shape->body !== null) {
            $sent = property_exists($input, 'body');
            $this->member($sent, $sent ? $input->body : null, $shape->body, '/body');
        }
    }

    public static function escape(string $token): string
    {
        return str_replace(['~', '/'], ['~0', '~1'], $token);
    }

    /** @param array<string, Member> $members */
    private function members(\stdClass $value, array $members, KeyPolicy $unknownKeys, string $pointer): void
    {
        foreach ($members as $name => $member) {
            $present = property_exists($value, (string) $name);
            $this->member($present, $present ? $value->{$name} : null, $member, $pointer . '/' . self::escape((string) $name));
        }

        if ($unknownKeys === KeyPolicy::Keep) {
            return;
        }

        foreach (array_keys(get_object_vars($value)) as $key) {
            if (!array_key_exists((string) $key, $members)) {
                $this->issue($pointer . '/' . self::escape((string) $key), Rule::UNKNOWN_KEYS);
            }
        }
    }

    private function member(bool $present, mixed $value, Member $member, string $pointer): void
    {
        if (!$present) {
            if ($member->presence === Presence::Required) {
                $this->issue($pointer, Rule::REQUIRED);
            }

            return;
        }

        if ($value === null) {
            if ($member->nullability === Nullability::NotNull) {
                $this->issue($pointer, Rule::TYPE);
            }

            return;
        }

        $typeIssue = $member->type->issueOf($value);
        if ($typeIssue !== null) {
            $this->issue($pointer, $typeIssue);

            return;
        }

        foreach ($member->checks->issuesOf($value) as $rule) {
            $this->issue($pointer, $rule);
        }
        if ($member->native !== []) {
            $this->validate($pointer, $value, $member->native);
        }

        if ($value instanceof \stdClass) {
            $this->members($value, $member->properties, $member->unknownKeys, $pointer);
        } elseif (is_array($value) && $member->items !== null) {
            foreach (array_values($value) as $index => $item) {
                $this->member(true, $item, $member->items, "{$pointer}/{$index}");
            }
        }
    }

    private function issue(string $pointer, string $rule): void
    {
        $this->validate($pointer, null, [new Issue($rule)]);
    }

    /** @param list<Constraint> $constraints */
    private function validate(string $pointer, mixed $value, array $constraints): void
    {
        $this->context->getValidator()->inContext($this->context)->atPath($pointer)->validate($value, $constraints);
    }
}
