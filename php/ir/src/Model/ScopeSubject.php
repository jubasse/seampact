<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ScopeSubject extends RightSubject
{
    /** The tag member 'kind': fixed to 'scope'. */
    public string $kind;

    /**
     * @param string $scope
     */
    public function __construct(
        public string $scope,
    ) {
        $this->kind = 'scope';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ScopeSubject');
        IrHydration::tag($members, 'kind', 'scope', 'ScopeSubject');

        return new self(
            scope: IrHydration::string(IrHydration::required($members, 'scope', 'ScopeSubject'), 'ScopeSubject.scope'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'scope'} = $this->scope;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
