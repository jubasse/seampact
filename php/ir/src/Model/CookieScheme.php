<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A credential in a cookie; 'csrf' names the scheme that carries the CSRF token. */
final readonly class CookieScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'cookie'. */
    public string $kind;

    /**
     * @param string $id
     * @param string $name The cookie name.
     * @param Origin $origin
     * @param string|null $csrf
     */
    public function __construct(
        public string $id,
        public string $name,
        public Origin $origin,
        public ?string $csrf = null,
    ) {
        $this->kind = 'cookie';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CookieScheme');
        IrHydration::tag($members, 'kind', 'cookie', 'CookieScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'CookieScheme'), 'CookieScheme.id'),
            name: IrHydration::string(IrHydration::required($members, 'name', 'CookieScheme'), 'CookieScheme.name'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'CookieScheme')),
            csrf: IrHydration::optional($members, 'csrf', static fn (mixed $item): string => IrHydration::string($item, 'CookieScheme.csrf')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        $json->{'name'} = $this->name;
        if ($this->csrf !== null) {
            $json->{'csrf'} = $this->csrf;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
