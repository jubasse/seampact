<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/**
 * Verifies a template-signed request (ADR 0013 "Where the verification happens"): rebuilds the signed payload from
 * the raw bytes, computes the MAC with each valid secret, compares it in constant time with each candidate, then
 * checks the timestamp against the tolerance in both directions.
 */
final class TemplateSignatureVerifier
{
    /** The only MAC this verifier computes; the IR enum is open, so another algorithm is refused by name. */
    public const SUPPORTED_ALGORITHM = 'hmac-sha256';

    private const HMAC_ALGORITHM = 'sha256';
    private const HMAC_SHA256_BYTES = 32;
    private const TIMESTAMP_PLACEHOLDER = '{ts}';
    private const RAW_BODY_PLACEHOLDER = '{rawBody}';
    private const MILLISECONDS_PER_SECOND = 1000;
    private const UNIX_SECONDS = '/^[0-9]+$/D';
    private const HEX = '/^(?:[0-9a-fA-F]{2})+$/D';
    private const BASE64 = '/^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/D';

    public function __construct(
        private readonly SecretLookup $secretLookup,
        private readonly Clock $clock = new SystemClock(),
    ) {
    }

    /**
     * @param string $rawBody the decoded body bytes, exactly as received
     * @param string|null $timestamp the signed timestamp text as received, when the header carries one
     * @param list<string> $candidateSignatures every signature the header carries, still encoded
     *
     * @throws UnsupportedSignatureAlgorithm when the scheme names another algorithm than hmac-sha256
     * @throws EmptySignatureSecret when the lookup returns an empty secret
     */
    public function verify(
        string $rawBody,
        ?string $timestamp,
        array $candidateSignatures,
        string $keyId,
        SignatureScheme $scheme,
    ): SignatureVerification {
        if ($scheme->algorithm !== self::SUPPORTED_ALGORITHM) {
            throw new UnsupportedSignatureAlgorithm($scheme->algorithm);
        }

        $signsTimestamp = str_contains($scheme->payload, self::TIMESTAMP_PLACEHOLDER);

        if ($signsTimestamp && $timestamp === null) {
            return SignatureVerification::failed(SignatureFailure::TimestampMissing);
        }

        $secrets = $this->secretLookup->secretsFor($keyId);

        if ($secrets === []) {
            return SignatureVerification::failed(SignatureFailure::NoSecret);
        }

        if (in_array('', $secrets, true)) {
            throw new EmptySignatureSecret($keyId);
        }

        $payload = self::signedPayload($scheme->payload, $rawBody, $timestamp ?? '');
        $candidates = self::decodedCandidates($candidateSignatures, $scheme->encoding);

        if (!self::anySecretMatches($secrets, $payload, $candidates)) {
            return SignatureVerification::failed(SignatureFailure::SignatureMismatch);
        }

        $timestampFailure = $this->timestampFailure($timestamp, $scheme->toleranceMs);

        return $timestampFailure === null
            ? SignatureVerification::verified()
            : SignatureVerification::failed($timestampFailure);
    }

    // The payload template with `{ts}` replaced by the timestamp text as received and `{rawBody}` by the raw bytes.
    private static function signedPayload(string $template, string $rawBody, string $timestamp): string
    {
        [$beforeBody, $afterBody] = explode(self::RAW_BODY_PLACEHOLDER, $template, 2) + ['', ''];

        return str_replace(self::TIMESTAMP_PLACEHOLDER, $timestamp, $beforeBody)
            . $rawBody
            . str_replace(self::TIMESTAMP_PLACEHOLDER, $timestamp, $afterBody);
    }

    /**
     * A candidate that does not decode in the declared encoding, or decodes to the wrong length, never matches.
     *
     * @param list<string> $candidateSignatures
     *
     * @return list<string>
     */
    private static function decodedCandidates(array $candidateSignatures, SignatureEncoding $encoding): array
    {
        $decodedCandidates = [];

        foreach ($candidateSignatures as $candidate) {
            $decoded = self::decodeCandidate($candidate, $encoding);

            if ($decoded !== null && strlen($decoded) === self::HMAC_SHA256_BYTES) {
                $decodedCandidates[] = $decoded;
            }
        }

        return $decodedCandidates;
    }

    private static function decodeCandidate(string $candidate, SignatureEncoding $encoding): ?string
    {
        $pattern = $encoding === SignatureEncoding::Hex ? self::HEX : self::BASE64;

        if (preg_match($pattern, $candidate) !== 1) {
            return null;
        }

        $decoded = $encoding === SignatureEncoding::Hex ? hex2bin($candidate) : base64_decode($candidate, true);

        return $decoded === false ? null : $decoded;
    }

    /**
     * Every secret against every candidate, without stopping at the first match.
     *
     * @param list<string> $secrets
     * @param list<string> $candidates
     */
    private static function anySecretMatches(array $secrets, string $payload, array $candidates): bool
    {
        $matched = false;

        foreach ($secrets as $secret) {
            $expected = hash_hmac(self::HMAC_ALGORITHM, $payload, $secret, true);

            foreach ($candidates as $candidate) {
                if (hash_equals($expected, $candidate)) {
                    $matched = true;
                }
            }
        }

        return $matched;
    }

    private function timestampFailure(?string $timestamp, ?int $toleranceMs): ?SignatureFailure
    {
        if ($toleranceMs === null) {
            return null;
        }

        if ($timestamp === null) {
            return SignatureFailure::TimestampMissing;
        }

        if (preg_match(self::UNIX_SECONDS, $timestamp) !== 1) {
            return SignatureFailure::TimestampMalformed;
        }

        // A float, so a timestamp too long for an integer lands far outside any tolerance rather than overflowing.
        $signedAtMs = (float) $timestamp * self::MILLISECONDS_PER_SECOND;

        if (abs($this->clock->nowMilliseconds() - $signedAtMs) > $toleranceMs) {
            return SignatureFailure::TimestampOutsideTolerance;
        }

        return null;
    }
}
