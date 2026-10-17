<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class TemplateSignature extends SignatureVerify
{
    /** The tag member 'verify': fixed to 'template'. */
    public string $verify;

    /**
     * @param string $format
     * @param string $algorithm
     * @param string $payload
     * @param SignatureEncoding $encoding
     * @param SchemeKey $key
     * @param int|null $toleranceMs
     */
    public function __construct(
        public string $format,
        public string $algorithm,
        public string $payload,
        public SignatureEncoding $encoding,
        public SchemeKey $key,
        public ?int $toleranceMs = null,
    ) {
        $this->verify = 'template';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'TemplateSignature');
        IrHydration::tag($members, 'verify', 'template', 'TemplateSignature');

        return new self(
            format: IrHydration::string(IrHydration::required($members, 'format', 'TemplateSignature'), 'TemplateSignature.format'),
            algorithm: IrHydration::string(IrHydration::required($members, 'algorithm', 'TemplateSignature'), 'TemplateSignature.algorithm'),
            payload: IrHydration::string(IrHydration::required($members, 'payload', 'TemplateSignature'), 'TemplateSignature.payload'),
            encoding: SignatureEncoding::fromJson(IrHydration::required($members, 'encoding', 'TemplateSignature')),
            key: SchemeKey::fromJson(IrHydration::required($members, 'key', 'TemplateSignature')),
            toleranceMs: IrHydration::optional($members, 'toleranceMs', static fn (mixed $item): int => IrHydration::integer($item, 'TemplateSignature.toleranceMs')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'verify'} = $this->verify;
        $json->{'format'} = $this->format;
        $json->{'algorithm'} = $this->algorithm;
        $json->{'payload'} = $this->payload;
        $json->{'encoding'} = $this->encoding->toJson();
        if ($this->toleranceMs !== null) {
            $json->{'toleranceMs'} = $this->toleranceMs;
        }
        $json->{'key'} = $this->key->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->verify;
    }
}
