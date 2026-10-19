<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Document-only facts of a bearer scheme. */
final readonly class BearerFacts
{
    /**
     * @param string|null $format
     * @param OAuth2|null $oauth2
     * @param string|null $openIdConnectUrl
     */
    public function __construct(
        public ?string $format = null,
        public ?OAuth2 $oauth2 = null,
        public ?string $openIdConnectUrl = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'BearerFacts');

        return new self(
            format: IrHydration::optional($members, 'format', static fn (mixed $item): string => IrHydration::string($item, 'BearerFacts.format')),
            oauth2: IrHydration::optional($members, 'oauth2', static fn (mixed $item): OAuth2 => OAuth2::fromJson($item)),
            openIdConnectUrl: IrHydration::optional($members, 'openIdConnectUrl', static fn (mixed $item): string => IrHydration::string($item, 'BearerFacts.openIdConnectUrl')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->format !== null) {
            $json->{'format'} = $this->format;
        }
        if ($this->oauth2 !== null) {
            $json->{'oauth2'} = $this->oauth2->toJson();
        }
        if ($this->openIdConnectUrl !== null) {
            $json->{'openIdConnectUrl'} = $this->openIdConnectUrl;
        }
        return $json;
    }
}
