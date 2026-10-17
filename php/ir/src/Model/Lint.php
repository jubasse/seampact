<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Lint
{
    /**
     * @param array<int|string, LintRule> $rules
     * @param list<LintAllow> $allows
     */
    public function __construct(
        public array $rules,
        public array $allows,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Lint');

        return new self(
            rules: IrHydration::mapOf(IrHydration::required($members, 'rules', 'Lint'), 'Lint.rules', static fn (mixed $item): LintRule => LintRule::fromJson($item)),
            allows: IrHydration::listOf(IrHydration::required($members, 'allows', 'Lint'), 'Lint.allows', static fn (mixed $item): LintAllow => LintAllow::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'rules'} = IrHydration::encodeMap($this->rules, static fn (LintRule $item): mixed => $item->toJson());
        $json->{'allows'} = IrHydration::encodeList($this->allows, static fn (LintAllow $item): mixed => $item->toJson());
        return $json;
    }
}
