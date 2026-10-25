<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\SignedWebhooks\Clock;
use Seampact\SignedWebhooks\EmptySignatureSecret;
use Seampact\SignedWebhooks\SecretLookup;
use Seampact\SignedWebhooks\SignatureEncoding;
use Seampact\SignedWebhooks\SignatureFailure;
use Seampact\SignedWebhooks\SignatureScheme;
use Seampact\SignedWebhooks\TemplateSignatureVerifier;
use Seampact\SignedWebhooks\UnsupportedSignatureAlgorithm;

// The ADR 0013 test vectors every ecosystem's helper passes, read from the npm package's vector file.
final class VectorsTest extends TestCase
{
    private const VECTORS_PATH = '/packages/runtime/signed-webhooks/vectors/adr-0013.json';
    public const KEY_ID_FOR_LOOKUP = 'test';
    private const KEY_ID = self::KEY_ID_FOR_LOOKUP;
    private const MILLISECONDS_PER_SECOND = 1000;
    private const PAIR_FORMAT = '/^(?:[A-Za-z0-9]+=\{(?:ts|sig)\},?)+$/D';
    private const TIMESTAMP_PLACEHOLDER = '{ts}';
    private const SIGNATURE_PLACEHOLDER = '{sig}';

    // Why each 401 vector fails: a wrong MAC, or a timestamp outside the tolerance.
    private const FAILURE_OF_VECTOR = [
        'G3' => SignatureFailure::SignatureMismatch,
        'S3' => SignatureFailure::TimestampOutsideTolerance,
        'S4' => SignatureFailure::TimestampOutsideTolerance,
        'S5' => SignatureFailure::SignatureMismatch,
        'S8' => SignatureFailure::SignatureMismatch,
    ];

    /** @return array<string, mixed> */
    private static function vectors(): array
    {
        $text = file_get_contents(dirname(__DIR__, 3) . self::VECTORS_PATH);

        if ($text === false) {
            throw new \RuntimeException('The ADR 0013 vector file cannot be read.');
        }

        return self::object(json_decode($text, true, flags: JSON_THROW_ON_ERROR));
    }

    /** @return iterable<string, array{array<string, mixed>, array<string, mixed>}> */
    public static function cases(): iterable
    {
        $vectors = self::vectors();
        $schemes = self::object($vectors['schemes']);

        foreach (self::listOf($vectors['cases']) as $entry) {
            $case = self::object($entry);

            yield self::text($case, 'id') => [$case, self::object($schemes[self::text($case, 'scheme')])];
        }
    }

    /**
     * @param array<string, mixed> $case
     * @param array<string, mixed> $scheme
     */
    #[DataProvider('cases')]
    public function testVector(array $case, array $scheme): void
    {
        [$timestamp, $candidates] = self::parseSignatureHeader(self::text($scheme, 'format'), self::text($case, 'header'));
        $nowSeconds = self::optionalInt($case, 'nowSeconds') ?? 0;
        $secrets = array_map(self::secretText(...), self::listOf($case['secrets']));

        $verifier = new TemplateSignatureVerifier(
            self::lookup($secrets),
            self::fixedClock($nowSeconds * self::MILLISECONDS_PER_SECOND),
        );
        $verification = $verifier->verify(self::text($case, 'body'), $timestamp, $candidates, self::KEY_ID, self::scheme($scheme));

        self::assertSame(self::text($case, 'expected'), $verification->isVerified() ? 'pass' : '401');
        self::assertSame(self::FAILURE_OF_VECTOR[self::text($case, 'id')] ?? null, $verification->failure);
    }

    public function testRefusesAnEmptySecretByName(): void
    {
        $verifier = new TemplateSignatureVerifier(self::lookup(['']));

        $this->expectException(EmptySignatureSecret::class);

        $verifier->verify('Hello, World!', null, ['00'], self::KEY_ID, self::githubScheme());
    }

    public function testRefusesAnotherAlgorithmByName(): void
    {
        $verifier = new TemplateSignatureVerifier(self::lookup(['secret']));
        $scheme = new SignatureScheme('hmac-sha512', '{rawBody}', SignatureEncoding::Hex);

        $this->expectException(UnsupportedSignatureAlgorithm::class);
        $this->expectExceptionMessage("'hmac-sha512'");

        $verifier->verify('', null, [], self::KEY_ID, $scheme);
    }

    public function testFailsWithoutASecretForTheKey(): void
    {
        $verification = (new TemplateSignatureVerifier(self::lookup([])))
            ->verify('Hello, World!', null, [], self::KEY_ID, self::githubScheme());

        self::assertSame(SignatureFailure::NoSecret, $verification->failure);
    }

    private static function githubScheme(): SignatureScheme
    {
        return new SignatureScheme(TemplateSignatureVerifier::SUPPORTED_ALGORITHM, '{rawBody}', SignatureEncoding::Hex);
    }

    /** @param array<string, mixed> $scheme */
    private static function scheme(array $scheme): SignatureScheme
    {
        return new SignatureScheme(
            self::text($scheme, 'algorithm'),
            self::text($scheme, 'payload'),
            SignatureEncoding::from(self::text($scheme, 'encoding')),
            self::optionalInt($scheme, 'toleranceMs'),
        );
    }

    /** @return array<string, mixed> */
    private static function object(mixed $value): array
    {
        self::assertIsArray($value);
        $object = [];

        foreach ($value as $key => $member) {
            $object[(string) $key] = $member;
        }

        return $object;
    }

    /** @return list<mixed> */
    private static function listOf(mixed $value): array
    {
        self::assertIsArray($value);

        return array_values($value);
    }

    /** @param array<string, mixed> $object */
    private static function text(array $object, string $key): string
    {
        $value = $object[$key] ?? null;
        self::assertIsString($value, $key);

        return $value;
    }

    private static function secretText(mixed $secret): string
    {
        self::assertIsString($secret);

        return $secret;
    }

    /** @param array<string, mixed> $object */
    private static function optionalInt(array $object, string $key): ?int
    {
        $value = $object[$key] ?? null;

        if ($value !== null) {
            self::assertIsInt($value, $key);
        }

        return $value;
    }

    /**
     * The header parsing the generated boundary does (ADR 0013 "Header parsing is fixed by the format"), enough for
     * the two formats of the vectors.
     *
     * @return array{?string, list<string>}
     */
    private static function parseSignatureHeader(string $format, string $header): array
    {
        if (preg_match(self::PAIR_FORMAT, $format) !== 1) {
            $prefix = str_replace(self::SIGNATURE_PLACEHOLDER, '', $format);

            return [null, str_starts_with($header, $prefix) ? [substr($header, strlen($prefix))] : []];
        }

        $placeholderOfName = [];

        foreach (explode(',', $format) as $item) {
            [$name, $placeholder] = explode('=', $item, 2) + ['', ''];
            $placeholderOfName[$name] = $placeholder;
        }

        $timestamp = null;
        $candidates = [];

        foreach (explode(',', $header) as $pair) {
            [$name, $value] = explode('=', $pair, 2) + ['', ''];
            $placeholder = $placeholderOfName[$name] ?? null;

            if ($placeholder === self::TIMESTAMP_PLACEHOLDER) {
                $timestamp = $value;
            } elseif ($placeholder === self::SIGNATURE_PLACEHOLDER) {
                $candidates[] = $value;
            }
        }

        return [$timestamp, $candidates];
    }

    /** @param list<string> $secrets */
    private static function lookup(array $secrets): SecretLookup
    {
        return new class ($secrets) implements SecretLookup {
            /** @param list<string> $secrets */
            public function __construct(private readonly array $secrets)
            {
            }

            public function secretsFor(string $keyId): array
            {
                return $keyId === VectorsTest::KEY_ID_FOR_LOOKUP ? $this->secrets : [];
            }
        };
    }

    private static function fixedClock(int $nowMilliseconds): Clock
    {
        return new class ($nowMilliseconds) implements Clock {
            public function __construct(private readonly int $nowMilliseconds)
            {
            }

            public function nowMilliseconds(): int
            {
                return $this->nowMilliseconds;
            }
        };
    }
}
