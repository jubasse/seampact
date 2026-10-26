<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * Each target entry's view of the IR (ADR 0011 "The app config"), as the Node CLI builds it before a target's
 * generate reads it (`api-refs.ts`, `filter-operations.ts`), with the same codes: the apis `api` or `apis` names,
 * an api named alone being the only one of its name among the sources, then for each api its `document` (its
 * surfaces, and `internal: exclude` drops internal operations), then `operations.include` (empty keeps all) and
 * `operations.exclude`, each item an operation id or a tag. Only `operations` shrinks; the rest of the IR is a copy
 * of the source's. The target reads the viewed document with its own support (`IrReader::readDocument`).
 */
final class EntryView
{
    private const SOURCE_SEPARATOR = '/';

    private function __construct()
    {
    }

    /**
     * Each `<source>/<api>` of the PHP entries whose source the app config does not define.
     *
     * @return list<ConfigProblem>
     */
    public static function unknownSourceProblems(AppConfig $config): array
    {
        $problems = [];
        $names = array_keys($config->sources);
        $listed = $names === [] ? 'none' : implode(', ', $names);

        foreach ($config->entries as $entry) {
            foreach ($entry->apiRefs() as $text) {
                [$source, $api] = self::parsed($text);
                if ($source !== null && !array_key_exists($source, $config->sources)) {
                    $problems[] = new ConfigProblem(
                        'config.api.unknown-source',
                        "The app config has no source '{$source}' ({$listed}).",
                        "Name one of the app config's `sources` before the '/', or add the source.",
                        self::where($entry->id(), $api),
                    );
                }
            }
        }

        return $problems;
    }

    /**
     * The sources the PHP entries use (ADR 0011: a source no entry uses is never resolved), as the Node CLI's
     * `sourcesHoldingRefs`: each source a `<source>/<api>` names and, for an api named alone, each source that may
     * hold it: a `path` source whose workspace lists it or cannot be read (its compile then says why), and every
     * bundle source, whose apis only its manifest tells.
     *
     * @return list<string>
     */
    public static function usedSources(AppConfig $config): array
    {
        $named = [];
        $bareApis = [];

        foreach ($config->entries as $entry) {
            foreach ($entry->apiRefs() as $text) {
                [$source, $api] = self::parsed($text);
                if ($source === null) {
                    $bareApis[] = $api;
                } else {
                    $named[] = $source;
                }
            }
        }

        $used = [];
        foreach ($config->sources as $name => $source) {
            if (in_array($name, $named, true) || ($bareApis !== [] && self::mayHoldAny($source, $bareApis))) {
                $used[] = $name;
            }
        }

        return $used;
    }

    /** @param list<string> $apis */
    private static function mayHoldAny(object $source, array $apis): bool
    {
        if (!$source instanceof LocalSource) {
            return true;
        }

        $names = WorkspaceApiNames::of($source->directory);

        return $names === null || array_intersect($names, $apis) !== [];
    }

    /** @param list<SourceApi> $apis the apis of every used source */
    public static function of(AppConfigEntry $entry, array $apis): EntryViewResult
    {
        $resolved = [];
        $problems = [];

        foreach ($entry->apiRefs() as $text) {
            [$source, $api] = self::parsed($text);
            $candidates = array_values(array_filter(
                $apis,
                static fn (SourceApi $candidate): bool => $candidate->api === $api && ($source === null || $candidate->source === $source),
            ));

            if (count($candidates) > 1) {
                $sources = implode(', ', array_map(static fn (SourceApi $candidate): string => "'{$candidate->source}'", $candidates));
                $problems[] = new ConfigProblem(
                    'config.api.ambiguous',
                    "The api '{$api}' exists in the sources {$sources}.",
                    "Name it as `<source>/{$api}`.",
                    self::where($entry->id(), $api),
                );
            } elseif ($candidates === []) {
                $problems[] = new ConfigProblem(
                    'config.api.unknown',
                    "No source of the app config holds an api '{$text}'.",
                    "Name an api of a source's `workspace.yaml`, as `<api>` or `<source>/<api>`.",
                    self::where($entry->id(), $api),
                );
            } elseif (isset($resolved[$candidates[0]->api])) {
                $problems[] = self::duplicateApiProblem($entry, $text, $candidates[0]->api);
            } else {
                $resolved[$candidates[0]->api] = $candidates[0];
            }
        }

        if ($problems !== []) {
            return new EntryViewResult([], $problems);
        }

        $viewed = [];
        foreach ($resolved as $api) {
            $filtered = self::filtered($api->ir, $entry);
            if (is_array($filtered)) {
                foreach ($filtered as $problem) {
                    $problems[] = $problem->withWhere(self::where($entry->id(), $api->api));
                }
                continue;
            }

            $viewed[] = new SourceApi($api->source, $api->api, $filtered);
        }

        return $problems === [] ? new EntryViewResult($viewed, []) : new EntryViewResult([], $problems);
    }

    /** @return array{?string, string} the source (null for an api named alone) and the api */
    private static function parsed(string $text): array
    {
        $separator = strpos($text, self::SOURCE_SEPARATOR);

        return $separator === false ? [null, $text] : [substr($text, 0, $separator), substr($text, $separator + 1)];
    }

    // ADR 0011 places each api under `<out>/<api>`, so two items of one entry cannot share an api name.
    private static function duplicateApiProblem(AppConfigEntry $entry, string $text, string $api): ConfigProblem
    {
        $items = array_filter($entry->apiRefs(), static fn (string $item): bool => self::parsed($item)[1] === $api);
        $listed = implode(', ', array_map(static fn (string $item): string => "'{$item}'", $items));

        return new ConfigProblem(
            'config.api.duplicate',
            "The entry '{$entry->id()}' names the api '{$api}' more than once ({$listed}); '{$text}' is one of them.",
            "Keep one of them, or give the sources' apis different names.",
            self::where($entry->id(), $api),
        );
    }

    private static function where(string $entryId, string $api): string
    {
        return "entry '{$entryId}', api '{$api}'";
    }

    /** @return \stdClass|list<ConfigProblem> a copy of `$ir` with the kept operations, or the problems */
    private static function filtered(\stdClass $ir, AppConfigEntry $entry): \stdClass|array
    {
        $operations = array_values(array_filter(JsonValue::list($ir, 'operations') ?? [], static fn (mixed $item): bool => $item instanceof \stdClass));
        $api = JsonValue::object($ir, 'api');
        $apiId = JsonValue::string($api, 'id') ?? '';
        $documents = JsonValue::object($api, 'documents') ?? new \stdClass();
        $document = $entry->document();

        $unknown = self::unknownSelectionProblems($apiId, $documents, $operations, $entry);
        if ($unknown !== []) {
            return $unknown;
        }

        $inDocument = array_values(array_filter($operations, static fn (\stdClass $operation): bool => self::isInDocument($documents, $document, $operation)));
        $removed = [];
        foreach ($entry->include() as $item) {
            if (!self::anyMatches($inDocument, $item)) {
                $removed[] = new ConfigProblem(
                    'filter.include.removed',
                    "The api '{$apiId}' keeps no operation for the include item '{$item}' once the document '" . ($document ?? '(none)') . "' has run.",
                    'Remove the item from `operations.include`, or choose a document that keeps it.',
                );
            }
        }
        if ($removed !== []) {
            return $removed;
        }

        $kept = array_values(array_filter($inDocument, static fn (\stdClass $operation): bool => self::isKept($operation, $entry)));
        $copy = JsonValue::copy($ir);
        if (!$copy instanceof \stdClass) {
            throw new \LogicException('seampact: the copy of an object is an object.');
        }
        $copy->operations = JsonValue::copy($kept);

        return $copy;
    }

    private static function isKept(\stdClass $operation, AppConfigEntry $entry): bool
    {
        $included = $entry->include() === [] || array_filter($entry->include(), static fn (string $item): bool => self::matches($operation, $item)) !== [];
        $excluded = array_filter($entry->exclude(), static fn (string $item): bool => self::matches($operation, $item)) !== [];

        return $included && !$excluded;
    }

    private static function isInDocument(\stdClass $documents, ?string $documentId, \stdClass $operation): bool
    {
        if ($documentId === null) {
            return true;
        }

        $document = JsonValue::object($documents, $documentId);
        if ($document === null) {
            return false;
        }

        if (JsonValue::string($document, 'internal') === 'exclude' && JsonValue::bool($operation, 'internal') === true) {
            return false;
        }

        return in_array(JsonValue::string($operation, 'surface'), JsonValue::strings($document, 'surfaces') ?? [], true);
    }

    private static function matches(\stdClass $operation, string $item): bool
    {
        return JsonValue::string($operation, 'id') === $item || in_array($item, JsonValue::strings($operation, 'tags') ?? [], true);
    }

    /** @param list<\stdClass> $operations */
    private static function anyMatches(array $operations, string $item): bool
    {
        foreach ($operations as $operation) {
            if (self::matches($operation, $item)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param list<\stdClass> $operations
     * @return list<ConfigProblem>
     */
    private static function unknownSelectionProblems(string $apiId, \stdClass $documents, array $operations, AppConfigEntry $entry): array
    {
        $problems = [];
        $document = $entry->document();

        if ($document !== null && !property_exists($documents, $document)) {
            $declared = array_keys(get_object_vars($documents));
            $listed = $declared === [] ? 'none declared' : implode(', ', $declared);
            $problems[] = new ConfigProblem(
                'filter.document.unknown',
                "The api '{$apiId}' declares no document '{$document}' ({$listed}).",
                "Name one of the api's `documents` in `document`, or remove `document`.",
            );
        }

        foreach ([...$entry->include(), ...$entry->exclude()] as $item) {
            if (!self::anyMatches($operations, $item)) {
                $problems[] = new ConfigProblem(
                    'filter.operation.unknown',
                    "The api '{$apiId}' has no operation id or tag '{$item}'.",
                    'Name an operation id or a tag of the api in `operations.include` or `operations.exclude`.',
                );
            }
        }

        return $problems;
    }
}
