<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\Digests;
use Seampact\Codegen\Runtime\FrameworkRoutes;
use Seampact\Codegen\Runtime\RuntimeVersion;
use Seampact\Codegen\Tests\Support\ReferenceContract;

/** The cross-language vectors of `fixtures/vectors/`, which the Node, Spring Boot and Python runtimes read too. */
final class SharedVectorsTest extends TestCase
{
    // The vectors write a catch-all `{*name}`; Laravel and Symfony write `{name}` with a pattern that takes a `/`.
    private const CATCH_ALL = '/\{\*(\w+)\}/';
    private const CATCH_ALL_PATTERN = '.+';

    /** @return iterable<string, array{\stdClass}> */
    public static function digestVectors(): iterable
    {
        return self::named(self::vectors('digests.json')->canonical);
    }

    /** @return iterable<string, array{\stdClass}> */
    public static function bodyVectors(): iterable
    {
        return self::named(self::vectors('digests.json')->bodies);
    }

    /** @return iterable<string, array{\stdClass}> */
    public static function routePatternVectors(): iterable
    {
        return self::named(self::vectors('framework-route-patterns.json')->vectors);
    }

    /** @return iterable<string, array{\stdClass}> */
    public static function runtimeVersionVectors(): iterable
    {
        foreach (self::listOf(self::vectors('runtime-versions.json')->vectors) as $vector) {
            yield self::text($vector, 'installed') . ' serves ' . self::text($vector, 'generator') => [$vector];
        }
    }

    #[DataProvider('digestVectors')]
    public function testDigestVector(\stdClass $vector): void
    {
        self::assertIsArray($vector->parts);
        $parts = array_values($vector->parts);

        self::assertSame($vector->text, Digests::canonical($parts));
        self::assertSame($vector->hex, Digests::hexOf($parts));
        self::assertSame($vector->base64Url, Digests::base64UrlOf($parts));
    }

    #[DataProvider('bodyVectors')]
    public function testEtagVector(\stdClass $vector): void
    {
        self::assertSame($vector->base64Url, Digests::base64UrlOfBytes(self::text($vector, 'body')));
    }

    #[DataProvider('routePatternVectors')]
    public function testRoutePatternVector(\stdClass $vector): void
    {
        $written = self::text($vector, 'route');
        preg_match_all(self::CATCH_ALL, $written, $catchAlls);
        $catchAllNames = $catchAlls[1];
        $route = (string) preg_replace(self::CATCH_ALL, '{$1}', $written);
        $patternOf = static fn (string $name): ?string => in_array($name, $catchAllNames, true) ? self::CATCH_ALL_PATTERN : null;
        $isOptional = static fn (string $name): bool => false;

        self::assertSame(
            $vector->allows,
            FrameworkRoutes::allows([['path' => self::text($vector, 'allowed'), 'method' => null]], $route, $patternOf, ['GET'], $isOptional),
        );
    }

    #[DataProvider('runtimeVersionVectors')]
    public function testRuntimeVersionVector(\stdClass $vector): void
    {
        self::assertSame($vector->serves, RuntimeVersion::accepts(self::text($vector, 'generator'), self::text($vector, 'installed')));
    }

    private static function vectors(string $file): \stdClass
    {
        $vectors = json_decode((string) file_get_contents(ReferenceContract::repositoryRoot() . '/fixtures/vectors/' . $file), false, 512, JSON_THROW_ON_ERROR);
        if (!$vectors instanceof \stdClass) {
            throw new \LogicException("The vectors file {$file} is not a JSON object.");
        }

        return $vectors;
    }

    /** @return iterable<string, array{\stdClass}> */
    private static function named(mixed $vectors): iterable
    {
        foreach (self::listOf($vectors) as $vector) {
            yield self::text($vector, 'name') => [$vector];
        }
    }

    private static function text(\stdClass $vector, string $member): string
    {
        $text = $vector->{$member} ?? null;
        if (!is_string($text)) {
            throw new \LogicException("A vector's '{$member}' is not a JSON string.");
        }

        return $text;
    }

    /** @return list<\stdClass> */
    private static function listOf(mixed $vectors): array
    {
        if (!is_array($vectors)) {
            throw new \LogicException('A vectors list is not a JSON array.');
        }

        $listed = [];
        foreach ($vectors as $vector) {
            if (!$vector instanceof \stdClass) {
                throw new \LogicException('A vector is not a JSON object.');
            }
            $listed[] = $vector;
        }

        return $listed;
    }
}
