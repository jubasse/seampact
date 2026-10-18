<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An allow of ADR 0002 section 12. */
final readonly class LintAllow
{
    /**
     * @param string $rule
     * @param Origin $at
     * @param string $reason
     * @param bool $subtree
     */
    public function __construct(
        public string $rule,
        public Origin $at,
        public string $reason,
        public bool $subtree,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'LintAllow');

        return new self(
            rule: IrHydration::string(IrHydration::required($members, 'rule', 'LintAllow'), 'LintAllow.rule'),
            at: Origin::fromJson(IrHydration::required($members, 'at', 'LintAllow')),
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'LintAllow'), 'LintAllow.reason'),
            subtree: IrHydration::boolean(IrHydration::required($members, 'subtree', 'LintAllow'), 'LintAllow.subtree'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'rule'} = $this->rule;
        $json->{'at'} = $this->at->toJson();
        $json->{'reason'} = $this->reason;
        $json->{'subtree'} = $this->subtree;
        return $json;
    }
}
