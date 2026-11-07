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

    /** @return iterable<string, array{string, string}> */
    public static function paths(): iterable
    {
        yield 'unreserved and slashes kept' => ['/v1/ch-1/a_b.c~d', '/v1/ch-1/a_b.c~d'];
        yield 'escapes kept' => ['/v1/ch/a%2Fb/caf%C3%A9', '/v1/ch/a%2Fb/caf%C3%A9'];
        yield 'a lone percent encoded' => ['/v1/100%', '/v1/100%25'];
        yield 'link delimiters encoded' => ['/v1/a>;rel="evil",<b', '/v1/a%3E%3Brel%3D%22evil%22%2C%3Cb'];
        yield 'raw bytes encoded' => ["/v1/caf\u{e9} x", '/v1/caf%C3%A9%20x'];
    }

    #[DataProvider('paths')]
    public function testARawPathIsLinkSafe(string $path, string $safe): void
    {
        self::assertSame($safe, WireValues::linkSafePath($path));
    }

    public function testAnUnexplodedListSplitsOnRawCommasOnlyThenDecodesEachItem(): void
    {
        $unexploded = ['kind' => 'list', 'explode' => false];

        self::assertSame(['createdAt,createdAt'], WireValues::listItems(['createdAt%2CcreatedAt'], $unexploded));
        self::assertSame(['a', 'b c'], WireValues::listItems(['a,b%20c'], $unexploded));
        self::assertSame(['a,b'], WireValues::listItems(['a%2Cb'], null));
    }

    public function testEachItemOfAListIsReadByItsTypeInTheRepeatAndCommaForms(): void
    {
        $integers = ['kind' => 'array', 'items' => ['kind' => 'scalar', 'type' => 'integer']];
        $repeat = ['kind' => 'list', 'explode' => true];
        $comma = ['kind' => 'list', 'explode' => false];

        self::assertSame([1, 20, 'ten'], WireValues::queryValue(WireValues::listItems(['1', '20', 'ten'], $repeat), $integers));
        self::assertSame([1, 20, 'ten'], WireValues::queryValue(WireValues::listItems(['1,20,ten'], $comma), $integers));
        self::assertSame([7], WireValues::queryValue(WireValues::listItems(['7'], $repeat), $integers));
        self::assertSame(['open', 'done'], WireValues::queryValue(WireValues::listItems(['open', 'done'], $repeat), ['kind' => 'array', 'items' => ['kind' => 'enum', 'enum' => 'TaskState']]));
    }
}
