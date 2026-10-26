<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * A template scheme's signature header parsed by its format (ADR 0013 "Test vectors"), as the Node and Spring targets
 * parse it: comma-separated `name=value` pairs (`t={ts},v1={sig}`), each slot read from its pair and a repeated
 * signature pair adding a candidate, or a literal prefix before `{sig}` (`sha256={sig}`).
 */
final readonly class SignatureHeader
{
    private const TIMESTAMP_SLOT = '{ts}';
    private const SIGNATURE_SLOT = '{sig}';
    private const DIGITS = '/^[0-9]+$/D';
    private const PAIR_FORMAT = '/^[A-Za-z0-9_-]+=\{(ts|sig)\}(,[A-Za-z0-9_-]+=\{(ts|sig)\})*$/D';

    /** @param list<string> $candidateSignatures */
    private function __construct(public ?string $timestamp, public array $candidateSignatures)
    {
    }

    /**
     * Null for a missing or malformed header: no signature, a timestamp that is not digits, a repeated timestamp, or
     * a pair that is not `name=value`.
     */
    public static function parse(string $format, #[\SensitiveParameter] ?string $header): ?self
    {
        if ($header === null || trim($header) === '') {
            return null;
        }
        if (preg_match(self::PAIR_FORMAT, $format) !== 1) {
            return self::prefixed($format, $header);
        }

        $timestampName = null;
        $signatureName = null;
        foreach (explode(',', $format) as $pair) {
            [$name, $slot] = explode('=', $pair, 2);
            if ($slot === self::TIMESTAMP_SLOT) {
                $timestampName = $name;
            } elseif ($slot === self::SIGNATURE_SLOT) {
                $signatureName = $name;
            }
        }
        if ($signatureName === null) {
            return null;
        }

        return self::pairs($header, $timestampName, $signatureName);
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['timestamp' => $this->timestamp, 'candidateSignatures' => \Seampact\Hooks\Redaction::REDACTED];
    }

    private static function pairs(#[\SensitiveParameter] string $header, ?string $timestampName, string $signatureName): ?self
    {
        $timestamp = null;
        $candidates = [];
        foreach (explode(',', $header) as $pair) {
            $separator = strpos($pair, '=');
            if ($separator === false || $separator === 0) {
                return null;
            }

            $name = trim(substr($pair, 0, $separator));
            $value = trim(substr($pair, $separator + 1));
            if ($name === $timestampName) {
                if ($timestamp !== null || preg_match(self::DIGITS, $value) !== 1) {
                    return null;
                }
                $timestamp = $value;
            } elseif ($name === $signatureName) {
                if ($value === '') {
                    return null;
                }
                $candidates[] = $value;
            }
        }

        if ($candidates === [] || $timestampName !== null && $timestamp === null) {
            return null;
        }

        return new self($timestamp, $candidates);
    }

    private static function prefixed(string $format, #[\SensitiveParameter] string $header): ?self
    {
        if (!str_ends_with($format, self::SIGNATURE_SLOT)) {
            return null;
        }

        $prefix = substr($format, 0, -strlen(self::SIGNATURE_SLOT));
        if (!str_starts_with($header, $prefix) || strlen($header) === strlen($prefix)) {
            return null;
        }

        return new self(null, [substr($header, strlen($prefix))]);
    }
}
