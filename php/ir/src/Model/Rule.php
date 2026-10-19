<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A rule (ADR 0004 section 4). */
final readonly class Rule
{
    private \stdClass $extensions;

    /**
     * @param string $id
     * @param bool $takesBucket
     * @param list<string> $errors
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param string|null $params
     * @param RuleProof|null $proof
     */
    public function __construct(
        public string $id,
        public bool $takesBucket,
        public array $errors,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?string $params = null,
        public ?RuleProof $proof = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Rule');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Rule'), 'Rule.id'),
            takesBucket: IrHydration::boolean(IrHydration::required($members, 'takesBucket', 'Rule'), 'Rule.takesBucket'),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'Rule'), 'Rule.errors', static fn (mixed $item): string => IrHydration::string($item, 'Rule.errors[]')),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Rule')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Rule'), 'Rule.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Rule')),
            params: IrHydration::optional($members, 'params', static fn (mixed $item): string => IrHydration::string($item, 'Rule.params')),
            proof: IrHydration::optional($members, 'proof', static fn (mixed $item): RuleProof => RuleProof::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        if ($this->params !== null) {
            $json->{'params'} = $this->params;
        }
        $json->{'takesBucket'} = $this->takesBucket;
        if ($this->proof !== null) {
            $json->{'proof'} = $this->proof->toJson();
        }
        $json->{'errors'} = $this->errors;
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
