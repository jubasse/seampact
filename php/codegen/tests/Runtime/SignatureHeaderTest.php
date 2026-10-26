<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\SignatureHeader;

/** A signature header parsed by its scheme's format, as the Node and Spring targets parse it (ADR 0013). */
final class SignatureHeaderTest extends TestCase
{
    private const STRIPE_FORMAT = 't={ts},v1={sig}';
    private const PREFIXED_FORMAT = 'sha256={sig}';

    public function testAPairFormatReadsTheTimestampAndEveryRepeatedSignature(): void
    {
        $parsed = SignatureHeader::parse(self::STRIPE_FORMAT, 't=1700000000, v1=abc,v0=ignored,v1=def');

        self::assertNotNull($parsed);
        self::assertSame('1700000000', $parsed->timestamp);
        self::assertSame(['abc', 'def'], $parsed->candidateSignatures);
    }

    public function testAPrefixFormatReadsTheSignatureAfterItsPrefix(): void
    {
        $parsed = SignatureHeader::parse(self::PREFIXED_FORMAT, 'sha256=0a1b');

        self::assertNotNull($parsed);
        self::assertNull($parsed->timestamp);
        self::assertSame(['0a1b'], $parsed->candidateSignatures);
    }

    /** @return iterable<string, array{string, ?string}> */
    public static function malformedHeaders(): iterable
    {
        yield 'missing' => [self::STRIPE_FORMAT, null];
        yield 'blank' => [self::STRIPE_FORMAT, '  '];
        yield 'no signature' => [self::STRIPE_FORMAT, 't=1700000000'];
        yield 'no timestamp' => [self::STRIPE_FORMAT, 'v1=abc'];
        yield 'timestamp not digits' => [self::STRIPE_FORMAT, 't=soon,v1=abc'];
        yield 'repeated timestamp' => [self::STRIPE_FORMAT, 't=1,t=2,v1=abc'];
        yield 'empty signature' => [self::STRIPE_FORMAT, 't=1,v1='];
        yield 'pair without name' => [self::STRIPE_FORMAT, 't=1,=abc,v1=abc'];
        yield 'pair without value' => [self::STRIPE_FORMAT, 't=1,v1=abc,junk'];
        yield 'other prefix' => [self::PREFIXED_FORMAT, 'sha1=0a1b'];
        yield 'prefix only' => [self::PREFIXED_FORMAT, 'sha256='];
    }

    #[DataProvider('malformedHeaders')]
    public function testAMalformedHeaderParsesToNothing(string $format, ?string $header): void
    {
        self::assertNull(SignatureHeader::parse($format, $header));
    }

    public function testADumpRedactsTheSignatures(): void
    {
        $parsed = SignatureHeader::parse(self::STRIPE_FORMAT, 't=1,v1=secret-mac');

        self::assertStringNotContainsString('secret-mac', print_r($parsed, true));
    }
}
