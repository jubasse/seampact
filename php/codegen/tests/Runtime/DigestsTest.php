<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\Digests;

/**
 * The digests write the text `JSON.stringify` writes, with sorted members, so an idempotency key, a throttle key and
 * an ETag are equal across targets; the vectors are the Spring target's and the Node targets'.
 */
final class DigestsTest extends TestCase
{
    public function testIdempotencyKeyPartsDigestAsOnTheNodeTargets(): void
    {
        self::assertSame('0e9711dfe19de9076c70514c7d5204e8816596cd427904fc6d562b0bbbc20cb4', Digests::hexOf(['tasks', 'createTask', 'user', '', 'key-1']));
    }

    public function testCanonicalTextSortsMembersAndWritesNumbersAndEscapesAsJavaScript(): void
    {
        $value = json_decode('{"b":1.5,"a":[1e21,1e-7,0.000001,-2,100],"é":"line\nbreak\u0001\"q\"","Z":true,"_":null}', false, 512, JSON_THROW_ON_ERROR);

        self::assertSame('{"Z":true,"_":null,"a":[1e+21,1e-7,0.000001,-2,100],"b":1.5,"é":"line\nbreak\u0001\"q\""}', Digests::canonical($value));
        self::assertSame('8418156b997e15c2cacd6ae3aa6e1a0bc3a66cfae86c8eca7147160fce9bc420', Digests::hexOf([$value]));
        self::assertSame('hBgVa5l-FcLKzWrjqm4aC8OmbProbI7KcUcWD86bxCA', Digests::base64UrlOf([$value]));
    }

    public function testCanonicalTextWritesIndexLikeMemberNamesFirstAsJavaScript(): void
    {
        $value = json_decode('{"b":3,"10":1,"9":2,"4294967295":4,"01":5,"4294967294":6,"-1":7}', false, 512, JSON_THROW_ON_ERROR);

        self::assertSame('{"9":2,"10":1,"4294967294":6,"-1":7,"01":5,"4294967295":4,"b":3}', Digests::canonical($value));
        self::assertSame('c7792be0e4e3e7cc71460895bde011d733bcbb0c495cbb3fd0540a551aff078b', Digests::hexOf([$value]));
    }

    public function testFractionsAndLargeIntegralFloatsAreWrittenPlain(): void
    {
        self::assertSame('[0.5,-0.25,123456.789,1e+300,2.5e-9,0]', Digests::canonical([0.5, -0.25, 123456.789, 1e300, 2.5e-9, -0.0]));
    }
}
