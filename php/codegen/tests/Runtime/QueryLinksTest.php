<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\WireValues;

/** The query pairs a page link keeps, encoded as the Spring and Node targets encode them. */
final class QueryLinksTest extends TestCase
{
    /** @return iterable<string, array{string, string}> */
    public static function components(): iterable
    {
        yield 'unreserved and marks kept' => ["a b/ü!*'()~", "a%20b%2F%C3%BC!*'()~"];
        yield 'delimiters encoded' => ['c2=&?#', 'c2%3D%26%3F%23'];
        yield 'multibyte' => ['Ω→x', '%CE%A9%E2%86%92x'];
    }

    #[DataProvider('components')]
    public function testAComponentIsEncodedAsEncodeUriComponentDoes(string $text, string $encoded): void
    {
        self::assertSame($encoded, WireValues::componentEncoded($text));
    }

    /** @return iterable<string, array{string, string}> */
    public static function pairs(): iterable
    {
        yield 'query characters kept' => ['q=a,b;c:d@e/f?g', 'q=a,b;c:d@e/f?g'];
        yield 'an escape kept' => ['q=%41%2c', 'q=%41%2c'];
        yield 'a lone percent encoded' => ['q=100%', 'q=100%25'];
        yield 'a percent before one hex digit encoded' => ['q=%4', 'q=%254'];
        yield 'angle brackets and quotes encoded' => ['q=<"x">', 'q=%3C%22x%22%3E'];
        yield 'raw bytes encoded' => ["q=\u{e9} x", 'q=%C3%A9%20x'];
    }

    #[DataProvider('pairs')]
    public function testAKeptPairIsLinkSafe(string $pair, string $safe): void
    {
        self::assertSame($safe, WireValues::linkSafe($pair));
    }

    public function testARawQueryCannotAddALinkRelation(): void
    {
        $kept = WireValues::keptQueryPairs('limit=1&q=a>;rel="evil",<https://evil.example/&cursor=c1', ['cursor']);

        self::assertSame(['limit=1', 'q=a%3E;rel=%22evil%22,%3Chttps://evil.example/'], $kept);
        self::assertStringNotContainsString('>', implode('&', $kept));
    }
}
