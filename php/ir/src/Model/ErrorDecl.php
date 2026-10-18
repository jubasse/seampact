<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An error code of the registry (ADR 0004 section 4). */
final readonly class ErrorDecl
{
    /**
     * @param string $code
     * @param NatureBase $nature
     * @param ErrorHttp $http
     * @param Docs $docs
     * @param Origin $origin
     * @param string|null $family The declared family, or the code up to its first dot.
     * @param string|null $natureName
     * @param string|null $params
     * @param IrOpaque|null $example
     * @param string|null $title
     * @param ErrorRole|null $default
     */
    public function __construct(
        public string $code,
        public NatureBase $nature,
        public ErrorHttp $http,
        public Docs $docs,
        public Origin $origin,
        public ?string $family = null,
        public ?string $natureName = null,
        public ?string $params = null,
        public ?IrOpaque $example = null,
        public ?string $title = null,
        public ?ErrorRole $default = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ErrorDecl');

        return new self(
            code: IrHydration::string(IrHydration::required($members, 'code', 'ErrorDecl'), 'ErrorDecl.code'),
            nature: NatureBase::fromJson(IrHydration::required($members, 'nature', 'ErrorDecl')),
            http: ErrorHttp::fromJson(IrHydration::required($members, 'http', 'ErrorDecl')),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'ErrorDecl')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'ErrorDecl')),
            family: IrHydration::optional($members, 'family', static fn (mixed $item): string => IrHydration::string($item, 'ErrorDecl.family')),
            natureName: IrHydration::optional($members, 'natureName', static fn (mixed $item): string => IrHydration::string($item, 'ErrorDecl.natureName')),
            params: IrHydration::optional($members, 'params', static fn (mixed $item): string => IrHydration::string($item, 'ErrorDecl.params')),
            example: IrHydration::optionalOpaque($members, 'example'),
            title: IrHydration::optional($members, 'title', static fn (mixed $item): string => IrHydration::string($item, 'ErrorDecl.title')),
            default: IrHydration::optional($members, 'default', static fn (mixed $item): ErrorRole => ErrorRole::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'code'} = $this->code;
        if ($this->family !== null) {
            $json->{'family'} = $this->family;
        }
        $json->{'nature'} = $this->nature->toJson();
        if ($this->natureName !== null) {
            $json->{'natureName'} = $this->natureName;
        }
        $json->{'http'} = $this->http->toJson();
        if ($this->params !== null) {
            $json->{'params'} = $this->params;
        }
        if ($this->example !== null) {
            $json->{'example'} = IrHydration::copy($this->example->value());
        }
        if ($this->title !== null) {
            $json->{'title'} = $this->title;
        }
        $json->{'docs'} = $this->docs->toJson();
        $json->{'origin'} = $this->origin->toJson();
        if ($this->default !== null) {
            $json->{'default'} = $this->default->toJson();
        }
        return $json;
    }
}
