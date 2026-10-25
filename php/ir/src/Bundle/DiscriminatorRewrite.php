<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * Every `{ discriminator, oneOf }` node of an IR schema file rewritten as `allOf` of one `if`/`then` per variant,
 * the rewrite the Kotlin reader runs, so a plain 2020-12 validator reads the open unions as Ajv does.
 */
final class DiscriminatorRewrite
{
    private const DEFINITION_PREFIX = '#/$defs/';

    private function __construct()
    {
    }

    public static function rewrite(string $fileName, \stdClass $schema): \stdClass
    {
        $definitions = $schema->{'$defs'} ?? new \stdClass();
        $rewritten = self::node($fileName, $schema, $definitions instanceof \stdClass ? $definitions : new \stdClass());

        if (!$rewritten instanceof \stdClass) {
            throw new \LogicException("seampact/ir: the IR schema {$fileName} is not an object.");
        }

        return $rewritten;
    }

    private static function node(string $fileName, mixed $node, \stdClass $definitions): mixed
    {
        if (is_array($node)) {
            return array_map(static fn (mixed $item): mixed => self::node($fileName, $item, $definitions), $node);
        }

        if (!$node instanceof \stdClass) {
            return $node;
        }

        $members = new \stdClass();
        foreach (get_object_vars($node) as $name => $value) {
            $members->{$name} = self::node($fileName, $value, $definitions);
        }

        if (isset($members->discriminator, $members->oneOf)) {
            return self::asConditions($fileName, $members, $definitions);
        }

        return $members;
    }

    private static function asConditions(string $fileName, \stdClass $union, \stdClass $definitions): \stdClass
    {
        $discriminator = $union->discriminator;
        $tagMember = $discriminator instanceof \stdClass ? $discriminator->propertyName ?? null : null;
        $variants = $union->oneOf;

        if (!is_string($tagMember) || !is_array($variants)) {
            throw new \LogicException("seampact/ir: the IR schema {$fileName} has a discriminator the union rewrite does not read.");
        }

        $conditions = [];
        foreach ($variants as $variant) {
            $conditions[] = (object) [
                'if' => (object) [
                    'properties' => (object) [$tagMember => (object) ['const' => self::tagOf($fileName, $variant, $tagMember, $definitions)]],
                    'required' => [$tagMember],
                ],
                'then' => $variant,
            ];
        }

        $rewritten = clone $union;
        unset($rewritten->discriminator, $rewritten->oneOf);
        $rewritten->allOf = $conditions;

        return $rewritten;
    }

    private static function tagOf(string $fileName, mixed $variant, string $tagMember, \stdClass $definitions): mixed
    {
        $reference = $variant instanceof \stdClass ? $variant->{'$ref'} ?? null : null;
        $name = is_string($reference) && str_starts_with($reference, self::DEFINITION_PREFIX)
            ? substr($reference, strlen(self::DEFINITION_PREFIX))
            : null;
        $definition = $name === null ? null : $definitions->{$name} ?? null;
        $properties = $definition instanceof \stdClass ? $definition->properties ?? null : null;
        $tag = $properties instanceof \stdClass ? $properties->{$tagMember} ?? null : null;

        if (!$tag instanceof \stdClass || !property_exists($tag, 'const')) {
            $shown = is_string($reference) ? $reference : 'a variant';
            throw new \LogicException("seampact/ir: the IR schema {$fileName} variant {$shown} has no const '{$tagMember}'; the union rewrite does not know it.");
        }

        return $tag->const;
    }
}
