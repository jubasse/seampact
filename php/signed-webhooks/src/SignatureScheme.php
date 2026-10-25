<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/**
 * A template signature scheme (ADR 0013): the MAC algorithm, the signed payload template and the encoding. The
 * application copies it from the hook's `Seampact\Hooks\SignatureTemplate`, tolerance included:
 * `new SignatureScheme($template->algorithm, $template->payload, SignatureEncoding::from($template->encoding->value), $template->toleranceMs)`.
 */
final readonly class SignatureScheme
{
    /**
     * @param string $payload the signed payload, with `{ts}` and `{rawBody}` placeholders
     * @param int|null $toleranceMs the largest distance allowed between the signed timestamp and now, required when
     *     the payload holds `{ts}`
     *
     * @throws TimestampWithoutTolerance when the payload holds `{ts}` and no tolerance is given
     */
    public function __construct(
        public string $algorithm,
        public string $payload,
        public SignatureEncoding $encoding,
        public ?int $toleranceMs = null,
    ) {
        if ($toleranceMs === null && str_contains($payload, TemplateSignatureVerifier::TIMESTAMP_PLACEHOLDER)) {
            throw new TimestampWithoutTolerance($payload);
        }
    }
}
