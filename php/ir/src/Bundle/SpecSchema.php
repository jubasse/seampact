<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/**
 * A JSON Schema of `@seampact/spec`, copied into `resources/schemas/` and checked through the pinned JSON Schema
 * 2020-12 validator, so no schema is ported by hand. The copies are kept equal to the spec by a test.
 */
final class SpecSchema
{
    private const RESOURCES = __DIR__ . '/../../resources/schemas';

    private const IR_SCHEMA_ID = 'https://seampact.dev/schemas/ir/ir.schema.json';

    private const MANIFEST_SCHEMA_ID = 'https://seampact.dev/schemas/bundle/manifest.schema.json';

    private static ?self $ir = null;

    private static ?self $manifest = null;

    private static ?\stdClass $manifestDocument = null;

    private function __construct(private readonly Validator $validator, private readonly string $rootId)
    {
    }

    /**
     * The open IR JSON Schema. Ajv reads the unions' `discriminator` keyword and a plain 2020-12 validator does
     * not, so each discriminated `oneOf` is rewritten into one `if`/`then` per known tag: a known tag validates
     * against its variant alone, an unknown tag against none, as the open form accepts it.
     */
    public static function ir(): self
    {
        if (self::$ir === null) {
            $validator = new Validator();

            foreach (glob(self::RESOURCES . '/ir/*.schema.json') ?: [] as $file) {
                $schema = self::load($file);
                $validator->resolver()?->registerRaw(DiscriminatorRewrite::rewrite(basename($file), $schema));
            }

            self::$ir = new self($validator, self::IR_SCHEMA_ID);
        }

        return self::$ir;
    }

    public static function manifest(): self
    {
        if (self::$manifest === null) {
            $validator = new Validator();
            $validator->resolver()?->registerRaw(self::manifestDocument());
            self::$manifest = new self($validator, self::MANIFEST_SCHEMA_ID);
        }

        return self::$manifest;
    }

    /** The manifest schema itself, the one source of the portable-path rule (`$defs/path`). */
    public static function manifestDocument(): \stdClass
    {
        return self::$manifestDocument ??= self::document('bundle/manifest.schema.json');
    }

    /** A shipped schema copy, by its path below `resources/schemas/` (`config/app.schema.json`). */
    public static function document(string $relativePath): \stdClass
    {
        return self::load(self::RESOURCES . '/' . $relativePath);
    }

    /**
     * The problems of `$document` (decoded with objects as `stdClass`), each `at '<pointer>' <problem>`; empty
     * when it is valid. The validator stops at its first error.
     *
     * @return list<string>
     */
    public function problems(mixed $document): array
    {
        $result = $this->validator->validate($document, $this->rootId);
        $error = $result->error();

        if ($error === null) {
            return [];
        }

        $problems = [];
        foreach ((new ErrorFormatter())->formatKeyed($error) as $pointer => $messages) {
            foreach (is_array($messages) ? $messages : [$messages] as $message) {
                $shown = is_string($message) ? $message : 'is not valid';
                $problems[] = 'at ' . BundleText::quoted((string) $pointer) . ' ' . BundleText::quoted($shown);
            }
        }

        return $problems;
    }

    private static function load(string $file): \stdClass
    {
        $text = file_get_contents($file);

        if ($text === false) {
            throw new \LogicException("seampact/ir: the schema '{$file}' cannot be read; reinstall seampact/ir.");
        }

        $schema = json_decode($text, false, 512, JSON_THROW_ON_ERROR);

        if (!$schema instanceof \stdClass) {
            throw new \LogicException("seampact/ir: the schema '{$file}' is not a JSON object; reinstall seampact/ir.");
        }

        return $schema;
    }
}
