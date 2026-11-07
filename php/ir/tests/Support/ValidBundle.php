<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/** The `valid` bundle of the shared vectors (`packages/core/spec/vectors/bundle`): its files, its tarball and its pin. */
final class ValidBundle
{
    private const VECTORS = '/packages/core/spec/vectors/bundle/vectors.json';

    private const VALID_ID = 'valid';

    public static function integrity(): string
    {
        return Json::string(self::vector('directories'), 'pin');
    }

    public static function tarball(): string
    {
        return self::decoded(Json::string(self::vector('archives'), 'base64'));
    }

    /** Writes the bundle's files below `$directory`. */
    public static function writeFiles(string $directory): void
    {
        foreach (Json::objects(self::vector('directories'), 'files') as $file) {
            TemporaryDirectory::write($directory, Json::string($file, 'path'), self::decoded(Json::string($file, 'base64')));
        }
    }

    private static function vector(string $kind): \stdClass
    {
        $vectors = Json::object(Json::decodeFile(Documents::repositoryRoot() . self::VECTORS));

        foreach (Json::objects($vectors, $kind) as $vector) {
            if (Json::string($vector, 'id') === self::VALID_ID) {
                return $vector;
            }
        }

        throw new \RuntimeException("test: the bundle vectors hold no '" . self::VALID_ID . "' {$kind} case.");
    }

    private static function decoded(string $base64): string
    {
        $bytes = base64_decode($base64, true);
        if ($bytes === false) {
            throw new \RuntimeException('test: a bundle vector is not base64.');
        }

        return $bytes;
    }
}
