<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

use Opis\JsonSchema\Errors\ValidationError;
use Opis\JsonSchema\Validator;
use Seampact\Ir\Bundle\SpecSchema;

/**
 * A config value checked against `app.schema.json` or `root.schema.json` of `@seampact/spec` (shipped copies),
 * through the pinned JSON Schema validator, so the schema is never ported by hand. Each error becomes the problem
 * `config.schema` in the Node CLI's forms: an unknown key, a missing key, a `oneOf` the value fits none of, or
 * another keyword. A `oneOf` names the innermost value that fits none of its forms.
 */
final class ConfigSchemaCheck
{
    private const SCHEMA_ID_BASE = 'https://seampact.dev/schemas/config/';

    private const ERRORS_MAX = 1000;

    private const ONE_OF = 'oneOf';

    private const SCHEMA_FIX = "Correct the value as the config schema states (ADR 0011 'The app config').";

    private const MOUNT_KEY = 'mount';

    private const MOUNT_RULE = "The key 'mount' is '/' then segments of ASCII letters, digits and '-._~!$&'()+,;=@:', with no trailing '/', no '*', no '.' or '..' segment and no segment starting with ':'.";

    private const MOUNT_FIX = "Write the path prefix the api is served under, such as '/api' (ADR 0011 'The app config').";

    private static ?Validator $validator = null;

    private function __construct()
    {
    }

    /**
     * The key problems first, then the schema problems they do not cover; empty when the value is valid.
     *
     * @param list<KeyProblem> $keyProblems problems the reader reports at a key before the schema check
     * @return list<ConfigProblem>
     */
    public static function problems(ConfigTree $tree, ConfigKind $kind, array $keyProblems = []): array
    {
        $result = self::validator()->validate($tree->value, self::SCHEMA_ID_BASE . $kind->schemaFile());
        $error = $result->error();
        $problems = array_map(static fn (KeyProblem $keyProblem): ConfigProblem => $keyProblem->problem, $keyProblems);

        if ($error === null) {
            return $problems;
        }

        $reported = array_map(static fn (KeyProblem $keyProblem): string => KeyPath::format($keyProblem->path), $keyProblems);
        $seen = [];

        foreach (self::located($error, $tree, $kind) as [$keyPath, $isOneOf, $problem]) {
            if (self::isCovered($keyPath, $isOneOf, $reported)) {
                continue;
            }

            $key = "{$problem->message}|{$problem->where}";
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $problems[] = $problem;
            }
        }

        return $problems;
    }

    private static function validator(): Validator
    {
        if (self::$validator === null) {
            $validator = new Validator(null, self::ERRORS_MAX, false);

            foreach (ConfigKind::cases() as $kind) {
                $validator->resolver()?->registerRaw(SpecSchema::document('config/' . $kind->schemaFile()));
            }

            self::$validator = $validator;
        }

        return self::$validator;
    }

    // A problem at or under a reported key repeats it; a `oneOf` that fails because of a reported key names it too.
    /** @param list<string> $reported */
    private static function isCovered(string $keyPath, bool $isOneOf, array $reported): bool
    {
        foreach ($reported as $path) {
            if (KeyPath::isAtOrBelow($keyPath, $path) || ($isOneOf && KeyPath::isBelow($path, $keyPath))) {
                return true;
            }
        }

        return false;
    }

    /** @return list<array{string, bool, ConfigProblem}> each leaf error with its key path and whether it is a `oneOf` */
    private static function located(ValidationError $error, ConfigTree $tree, ConfigKind $kind): array
    {
        $path = self::instancePath($error);

        if ($error->keyword() === self::ONE_OF) {
            $deeper = self::deeperOneOfs($error, KeyPath::format($path));
            if ($deeper === []) {
                return [[KeyPath::format($path), true, self::oneOfProblem($tree, $path)]];
            }

            $located = [];
            foreach ($deeper as $inner) {
                array_push($located, ...self::located($inner, $tree, $kind));
            }

            return $located;
        }

        $located = [];
        foreach (self::subErrors($error) as $inner) {
            array_push($located, ...self::located($inner, $tree, $kind));
        }

        if ($located !== [] || self::subErrors($error) !== []) {
            return $located;
        }

        return self::leafProblems($error, $path, $tree, $kind);
    }

    // An outer `oneOf` fails because an inner one did; the inner one names the value to correct.
    /** @return list<ValidationError> */
    private static function deeperOneOfs(ValidationError $error, string $keyPath): array
    {
        $found = [];

        foreach (self::subErrors($error) as $inner) {
            if ($inner->keyword() === self::ONE_OF && KeyPath::isBelow(KeyPath::format(self::instancePath($inner)), $keyPath)) {
                $found[] = $inner;
                continue;
            }

            array_push($found, ...self::deeperOneOfs($inner, $keyPath));
        }

        return $found;
    }

    /**
     * @param list<string|int> $path
     * @return list<array{string, bool, ConfigProblem}>
     */
    private static function leafProblems(ValidationError $error, array $path, ConfigTree $tree, ConfigKind $kind): array
    {
        $args = self::args($error);

        if ($error->keyword() === 'additionalProperties') {
            $problems = [];
            foreach (self::unknownKeys($error) as $key) {
                $withKey = [...$path, $key];
                $problems[] = [KeyPath::format($withKey), false, new ConfigProblem(
                    'config.schema',
                    "'{$key}' is not a key the {$kind->value} takes here.",
                    "Remove the key, or correct its spelling (ADR 0011 'The app config').",
                    $tree->whereOf($withKey),
                )];
            }

            return $problems;
        }

        if ($error->keyword() === 'required' && is_array($args['missing'] ?? null)) {
            $problems = [];
            foreach ($args['missing'] as $missing) {
                $name = is_scalar($missing) ? (string) $missing : '';
                $problems[] = [KeyPath::format($path), false, new ConfigProblem(
                    'config.schema',
                    "The key '{$name}' is required here.",
                    "Add '{$name}'.",
                    $tree->whereOf($path),
                )];
            }

            return $problems;
        }

        if ($error->keyword() === 'pattern' && ($path[array_key_last($path) ?? 0] ?? null) === self::MOUNT_KEY) {
            return [[KeyPath::format($path), false, new ConfigProblem('config.schema', self::MOUNT_RULE, self::MOUNT_FIX, $tree->whereOf($path))]];
        }

        $message = self::interpolated($error->message(), $args);

        return [[KeyPath::format($path), false, new ConfigProblem(
            'config.schema',
            "The value fails the schema keyword '{$error->keyword()}': {$message}.",
            self::SCHEMA_FIX,
            $tree->whereOf($path),
        )]];
    }

    // The validator lists every member it did not match by name; the unknown ones are those no `properties` or
    // `patternProperties` entry of the schema names.
    /** @return list<string> */
    private static function unknownKeys(ValidationError $error): array
    {
        $schema = $error->schema()->info()->data();
        $properties = $schema instanceof \stdClass && ($schema->properties ?? null) instanceof \stdClass ? get_object_vars($schema->properties) : [];
        $patterns = $schema instanceof \stdClass && ($schema->patternProperties ?? null) instanceof \stdClass ? array_keys(get_object_vars($schema->patternProperties)) : [];
        $listed = self::args($error)['properties'] ?? [];
        $unknown = [];

        foreach (is_array($listed) ? $listed : [] as $key) {
            $key = is_scalar($key) ? (string) $key : '';
            if (array_key_exists($key, $properties) || self::matchesAny($key, $patterns)) {
                continue;
            }
            $unknown[] = $key;
        }

        return $unknown;
    }

    /** @param list<int|string> $patterns */
    private static function matchesAny(string $key, array $patterns): bool
    {
        foreach ($patterns as $pattern) {
            if (preg_match('/' . str_replace('/', '\/', (string) $pattern) . '/u', $key) === 1) {
                return true;
            }
        }

        return false;
    }

    /** @return list<ValidationError> */
    private static function subErrors(ValidationError $error): array
    {
        return array_values(array_filter($error->subErrors(), static fn (mixed $inner): bool => $inner instanceof ValidationError));
    }

    /** @return array<string, mixed> */
    private static function args(ValidationError $error): array
    {
        $args = [];
        foreach ($error->args() as $name => $value) {
            $args[(string) $name] = $value;
        }

        return $args;
    }

    /** @return list<string|int> */
    private static function instancePath(ValidationError $error): array
    {
        return array_values($error->data()->fullPath());
    }

    /** @param array<string, mixed> $args */
    private static function interpolated(string $message, array $args): string
    {
        return (string) preg_replace_callback('/\{(\w+)\}/', static function (array $match) use ($args): string {
            $value = $args[$match[1]] ?? null;

            return is_scalar($value) ? (string) $value : (string) json_encode($value);
        }, $message);
    }

    /** @param list<string|int> $path */
    private static function oneOfProblem(ConfigTree $tree, array $path): ConfigProblem
    {
        [$message, $fix] = self::oneOfSentences($path);

        return new ConfigProblem('config.schema', $message, $fix, $tree->whereOf($path));
    }

    // The forms a `oneOf` of the config schemas lets a value take, by where it sits.
    /**
     * @param list<string|int> $path
     * @return array{string, string}
     */
    private static function oneOfSentences(array $path): array
    {
        $first = $path[0] ?? null;
        $last = $path === [] ? null : $path[array_key_last($path)];

        return match (true) {
            $first === 'sources' => [
                "A source takes one form: 'path', 'package' with 'version', 'release', 'git' or 'maven'; 'integrity' goes with a bundle form only.",
                "Keep the keys of one form (ADR 0011 'The app config').",
            ],
            $last === 'frameworkRoutes' && ($path[count($path) - 2] ?? null) === 'bootCheck' => [
                "'bootCheck.frameworkRoutes' is true, false or 'strict'.",
                "Write true to check the app routes under the contract's base paths, 'strict' to check every app route, or false to switch the check off.",
            ],
            $last === 'bootCheck' => [
                "'bootCheck' is true, false or '{ frameworkRoutes }'.",
                "Switch the boot check with a boolean, or its framework-route check alone with '{ frameworkRoutes: false }'.",
            ],
            $first === 'targets' => [
                "A target entry takes exactly one of 'api' and 'apis'.",
                "Name one api with 'api', or several with 'apis'.",
            ],
            $last === 'extensions' => [
                "'extensions' is 'all', 'none' or a list of extension names.",
                "Write 'all', 'none' or a list such as [access, paging].",
            ],
            count($path) === 1 => [
                "'openapi' is 'none' or a mapping from api names to their documents.",
                "Write 'openapi: none', or map each api to its document's path.",
            ],
            default => [
                "An api's documents are a path, '{ path, ...options }', or a mapping from each document id to one of those.",
                "Write the path of the api's one document, or map each of its documents to a path (ADR 0011 'The app config').",
            ],
        };
    }
}
