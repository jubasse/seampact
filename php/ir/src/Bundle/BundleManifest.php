<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** The manifest `seampact-bundle.json`, read from a document the manifest schema accepted. */
final readonly class BundleManifest
{
    /**
     * @param list<BundleApi> $apis
     * @param list<BundleLabel> $packs
     * @param list<BundleFile> $files
     */
    public function __construct(
        public int $formatVersion,
        public BundleLabel $contract,
        public array $apis,
        public BundleLabel $compiler,
        public array $packs,
        public array $files,
        public string $integrity,
    ) {
    }

    /** The manifest of a document the schema accepted; a size such as `53.0` reads as the integer it is. */
    public static function ofSchemaValid(\stdClass $document): self
    {
        return new self(
            self::integer($document->formatVersion),
            self::label($document->contract),
            array_map(
                static fn (\stdClass $api): BundleApi => new BundleApi(
                    self::text($api->name),
                    self::text($api->file),
                    self::integer($api->irVersion),
                    self::integer($api->irRevision),
                ),
                self::objects($document->apis),
            ),
            self::label($document->compiler),
            array_map(self::label(...), self::objects($document->packs)),
            array_map(
                static fn (\stdClass $file): BundleFile => new BundleFile(
                    self::text($file->path),
                    self::integer($file->size),
                    self::text($file->sha256),
                ),
                self::objects($document->files),
            ),
            self::text($document->integrity),
        );
    }

    private static function label(mixed $value): BundleLabel
    {
        $object = self::object($value);

        return new BundleLabel(self::text($object->name), self::text($object->version));
    }

    /** @return list<\stdClass> */
    private static function objects(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw self::notSchemaValid();
        }

        return array_map(self::object(...), $value);
    }

    private static function object(mixed $value): \stdClass
    {
        return $value instanceof \stdClass ? $value : throw self::notSchemaValid();
    }

    private static function text(mixed $value): string
    {
        return is_string($value) ? $value : throw self::notSchemaValid();
    }

    private static function integer(mixed $value): int
    {
        if (is_int($value)) {
            return $value;
        }

        return is_float($value) && floor($value) === $value && abs($value) <= PHP_INT_MAX ? (int) $value : throw self::notSchemaValid();
    }

    private static function notSchemaValid(): \LogicException
    {
        return new \LogicException('bundle: a manifest the schema accepted does not have the schema\'s shape.');
    }
}
