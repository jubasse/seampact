<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ApplicationSignature extends SignatureVerify
{
    /** The tag member 'verify': fixed to 'application'. */
    public string $verify;

    /**
     * @param list<string> $headers
     * @param SchemeKey|null $key
     */
    public function __construct(
        public array $headers,
        public ?SchemeKey $key = null,
    ) {
        $this->verify = 'application';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ApplicationSignature');
        IrHydration::tag($members, 'verify', 'application', 'ApplicationSignature');

        return new self(
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'ApplicationSignature'), 'ApplicationSignature.headers', static fn (mixed $item): string => IrHydration::string($item, 'ApplicationSignature.headers[]')),
            key: IrHydration::optional($members, 'key', static fn (mixed $item): SchemeKey => SchemeKey::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'verify'} = $this->verify;
        $json->{'headers'} = $this->headers;
        if ($this->key !== null) {
            $json->{'key'} = $this->key->toJson();
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->verify;
    }
}
