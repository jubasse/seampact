<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** A place in the IR, or in the target entry for an option: its JSON Pointer and the operation it is in. */
final readonly class IrPlace
{
    public function __construct(public string $member, public ?string $operation = null)
    {
    }

    public static function root(): self
    {
        return new self('');
    }

    public static function ofOperation(int $index, string $operationId): self
    {
        return new self("/operations/{$index}", $operationId);
    }

    public function below(string|int ...$segments): self
    {
        $suffix = implode('', array_map(
            static fn (string|int $segment): string => '/' . str_replace(['~', '/'], ['~0', '~1'], (string) $segment),
            $segments,
        ));

        return new self($this->member . $suffix, $this->operation);
    }
}
