<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

use Seampact\Ir\Model\IrShape;
use Seampact\Ir\Model\IrShapes;

/**
 * Returns one refusal per unknown tag or value of a must-act union or open enum (ADR 0005 section 3), found by
 * walking the raw document with the generated shapes: the same walk as `listIrUnknowns`, so an unknown that is
 * not must-act is left to the model (it keeps it as `Unknown`). Array items and map values are walked; unknown
 * members and opaque values are data, never walked, and a union with an unknown tag is not descended into. Never
 * throws on a malformed document: a shape the schema refuses is skipped, and the hydration that follows reports
 * it. Stops after 100 refusals. The walk recurses per level: `IrReader` bounds the nesting of the whole document
 * first.
 */
final class MustActCheck
{
    private const ROOT_DEFINITION = 'ContractIR';

    private RefusalList $refusals;

    /** @var array<string, IrShape> */
    private array $shapes;

    private function __construct(private readonly mixed $document)
    {
        $this->refusals = new RefusalList();
        $this->shapes = IrShapes::table();
    }

    /** @return list<IrRefusal> */
    public static function check(mixed $ir): array
    {
        $walk = new self($ir);
        $walk->walk($ir, IrShape::named(self::ROOT_DEFINITION), null);

        return $walk->refusals->all();
    }

    private function walk(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if ($this->refusals->isFull()) {
            return;
        }

        match ($shape->kind) {
            IrShape::NAMED => $this->walkNamed($value, $shape, $pointer),
            IrShape::STRUCT => $this->walkStruct($value, $shape, $pointer),
            IrShape::UNION => $this->walkUnion($value, $shape, $pointer),
            IrShape::OPEN_ENUM => $this->walkOpenEnum($value, $shape, $pointer),
            IrShape::ITEMS => $this->walkItems($value, $shape, $pointer),
            default => $this->walkValues($value, $shape, $pointer),
        };
    }

    private function walkNamed(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        $named = $this->shapes[$shape->definition ?? ''] ?? null;
        if ($named !== null) {
            $this->walk($value, $named, $pointer);
        }
    }

    private function walkStruct(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if (!$value instanceof \stdClass) {
            return;
        }

        foreach (get_object_vars($value) as $name => $child) {
            $memberShape = $shape->members[$name] ?? null;
            if ($memberShape !== null) {
                $this->walk($child, $memberShape, new PointerStep($pointer, (string) $name));
            }
        }
    }

    private function walkUnion(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if (!$value instanceof \stdClass) {
            return;
        }

        $tagMember = $shape->tag ?? '';
        $tag = $value->{$tagMember} ?? null;
        if (!is_string($tag)) {
            return;
        }

        $variant = $shape->variants[$tag] ?? null;
        if ($variant !== null) {
            $this->walk($value, IrShape::named($variant), $pointer);

            return;
        }
        if ($shape->mustAct) {
            $expected = array_map(static fn (int|string $known): string => (string) $known, array_keys($shape->variants));
            $this->refuse(new PointerStep($pointer, $tagMember), $tag, $expected, 'tag');
        }
    }

    private function walkOpenEnum(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if (is_string($value) && $shape->mustAct && !in_array($value, $shape->known, true)) {
            $this->refuse($pointer, $value, $shape->known, 'value');
        }
    }

    private function walkItems(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if (!is_array($value) || $shape->of === null) {
            return;
        }

        foreach ($value as $index => $item) {
            $this->walk($item, $shape->of, new PointerStep($pointer, (string) $index));
        }
    }

    private function walkValues(mixed $value, IrShape $shape, ?PointerStep $pointer): void
    {
        if (!$value instanceof \stdClass || $shape->of === null) {
            return;
        }

        foreach (get_object_vars($value) as $key => $item) {
            $this->walk($item, $shape->of, new PointerStep($pointer, (string) $key));
        }
    }

    /** @param list<string> $expected */
    private function refuse(?PointerStep $pointer, string $value, array $expected, string $what): void
    {
        $member = PointerStep::toPointer($pointer);
        $operation = $this->operationAt($member);
        $where = $operation === null ? '' : sprintf(" in operation '%s'", RefusalText::inMessage($operation));

        $this->refusals->add(new IrRefusal(
            IrRefusalCode::MustActUnknown,
            $member,
            $value,
            $expected,
            $operation,
            sprintf(
                "The %s '%s' at %s%s is unknown to this reader and guards a security boundary: a reader that skipped it would apply a weaker check, so it refuses the IR.",
                $what,
                RefusalText::inMessage($value),
                RefusalText::inMessage($member),
                $where,
            ),
        ));
    }

    private function operationAt(string $pointer): ?string
    {
        if (preg_match('#^/operations/(\d+)(/|$)#', $pointer, $matches) !== 1) {
            return null;
        }

        $index = (int) $matches[1];
        $operations = $this->document instanceof \stdClass ? ($this->document->operations ?? null) : null;
        $operation = is_array($operations) ? ($operations[$index] ?? null) : null;
        $id = $operation instanceof \stdClass ? ($operation->id ?? null) : null;

        return is_string($id) ? $id : '#' . $index;
    }
}
