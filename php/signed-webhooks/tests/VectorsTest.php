<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\SignedWebhooks\Clock;
use Seampact\SignedWebhooks\EmptySignatureSecret;
use Seampact\SignedWebhooks\SecretLookup;
use Seampact\SignedWebhooks\SignaturePayloadInvalid;
use Seampact\SignedWebhooks\SignatureEncoding;
use Seampact\SignedWebhooks\SignatureFailure;
use Seampact\SignedWebhooks\SignatureScheme;
use Seampact\SignedWebhooks\TemplateSignatureVerifier;
use Seampact\SignedWebhooks\TimestampWithoutTolerance;
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
    public const CURRENT_SECRET = 'whsec_CURRENT_SECRET';
    private const SENSITIVE_BODY = '{"card":"4242 4242 4242 4242"}';
    private const FIVE_MINUTES_MS = 300000;

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

    public function testRefusesANonStringSecretWithoutLeakingTheOtherSecretsThroughTheTrace(): void
    {
        $previousIgnoreArgs = ini_set('zend.exception_ignore_args', '0');
        $verifier = new TemplateSignatureVerifier(self::lookupWithAnUnsetSecret());

        try {
            $verifier->verify(self::SENSITIVE_BODY, null, ['00'], self::KEY_ID, self::githubScheme());
            self::fail('A secret that is not a string must be refused.');
        } catch (\Throwable $refusal) {
            self::assertInstanceOf(EmptySignatureSecret::class, $refusal);
            self::assertSame(1, $refusal->index);

            $trace = print_r(self::verifierFrames($refusal), true);
            self::assertStringNotContainsString(self::CURRENT_SECRET, $trace);
            self::assertStringNotContainsString(self::SENSITIVE_BODY, $trace);
        } finally {
            ini_set('zend.exception_ignore_args', $previousIgnoreArgs === false ? '1' : $previousIgnoreArgs);
        }
    }

    public function testRefusesASchemeThatSignsTheTimestampWithoutATolerance(): void
    {
        $this->expectException(TimestampWithoutTolerance::class);

        new SignatureScheme(TemplateSignatureVerifier::SUPPORTED_ALGORITHM, '{ts}.{rawBody}', SignatureEncoding::Hex);
    }

    #[DataProvider('payloadsWithoutOneRawBody')]
    public function testRefusesAPayloadThatDoesNotHoldTheRawBodyOnce(string $payload): void
    {
        $this->expectException(SignaturePayloadInvalid::class);

        new SignatureScheme(TemplateSignatureVerifier::SUPPORTED_ALGORITHM, $payload, SignatureEncoding::Hex, 1000);
    }

    /** @return array<string, array{string}> */
    public static function payloadsWithoutOneRawBody(): array
    {
        return [
            'no body' => ['{ts}.'],
            'empty' => [''],
            'body twice' => ['{rawBody}{rawBody}'],
            'timestamp twice' => ['{ts}{ts}{rawBody}'],
        ];
    }

    public function testFailsWhenTheSignedTimestampIsMissing(): void
    {
        $verification = (new TemplateSignatureVerifier(self::lookup(['secret'])))
            ->verify('Hello, World!', null, ['00'], self::KEY_ID, self::timestampScheme());

        self::assertSame(SignatureFailure::TimestampMissing, $verification->failure);
    }

    public function testFailsWhenTheSignedTimestampIsNotUnixSeconds(): void
    {
        $timestamp = '1e9';
        $signature = hash_hmac('sha256', "$timestamp.Hello, World!", 'secret');

        $verification = (new TemplateSignatureVerifier(self::lookup(['secret']), self::fixedClock(0)))
            ->verify('Hello, World!', $timestamp, [$signature], self::KEY_ID, self::timestampScheme());

        self::assertSame(SignatureFailure::TimestampMalformed, $verification->failure);
    }

    public function testACandidateThatIsNotHexNeverMatches(): void
    {
        $signature = hash_hmac('sha256', 'Hello, World!', 'secret');

        $verification = (new TemplateSignatureVerifier(self::lookup(['secret'])))
            ->verify('Hello, World!', null, ['g' . substr($signature, 1)], self::KEY_ID, self::githubScheme());

        self::assertSame(SignatureFailure::SignatureMismatch, $verification->failure);
    }

    public function testACandidateOfTheWrongLengthNeverMatches(): void
    {
        $truncatedMac = substr(hash_hmac('sha256', 'Hello, World!', 'secret', true), 0, 31);
        $scheme = new SignatureScheme(TemplateSignatureVerifier::SUPPORTED_ALGORITHM, '{rawBody}', SignatureEncoding::Base64);

        $verification = (new TemplateSignatureVerifier(self::lookup(['secret'])))
            ->verify('Hello, World!', null, [base64_encode($truncatedMac)], self::KEY_ID, $scheme);

        self::assertSame(SignatureFailure::SignatureMismatch, $verification->failure);
    }

    /** @return list<array<string, mixed>> the frames of the verifier, without the test runner around them */
    private static function verifierFrames(\Throwable $refusal): array
    {
        return array_values(array_filter(
            $refusal->getTrace(),
            static fn (array $frame): bool => str_starts_with($frame['class'] ?? '', 'Seampact\\SignedWebhooks\\'),
        ));
    }

    private static function timestampScheme(): SignatureScheme
    {
        return new SignatureScheme(
            TemplateSignatureVerifier::SUPPORTED_ALGORITHM,
            '{ts}.{rawBody}',
            SignatureEncoding::Hex,
            self::FIVE_MINUTES_MS,
        );
    }

    // A rotation list whose second secret comes from an unset environment variable, as `getenv` answers it.
    private static function lookupWithAnUnsetSecret(): SecretLookup
    {
        return new class implements SecretLookup {
            public function secretsFor(string $keyId): array
            {
                // @phpstan-ignore return.type (the lookup is typed, but an application can still return what getenv gave it)
                return [VectorsTest::CURRENT_SECRET, false];
            }
        };
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
