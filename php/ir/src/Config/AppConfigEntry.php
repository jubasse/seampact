<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * One target entry with its absolute output root, `<outDir>/<out>`. `entry` is the entry as the config writes it, a
 * copy; the typed members are read from it.
 */
final readonly class AppConfigEntry
{
    public function __construct(public \stdClass $entry, public string $root)
    {
    }

    public function id(): string
    {
        return JsonValue::string($this->entry, 'id') ?? '';
    }

    public function use(): string
    {
        return JsonValue::string($this->entry, 'use') ?? '';
    }

    public function ecosystem(): TargetEcosystem
    {
        return TargetEcosystem::of($this->use());
    }

    /**
     * The entry's `api`, or each of its `apis`: an api name alone, or `<source>/<api>`.
     *
     * @return list<string>
     */
    public function apiRefs(): array
    {
        $apis = JsonValue::strings($this->entry, 'apis');
        if ($apis !== null) {
            return $apis;
        }

        $api = JsonValue::string($this->entry, 'api');

        return $api === null ? [] : [$api];
    }

    /** Whether the entry names several apis with `apis`, each generated under `<out>/<api>`. */
    public function namesSeveralApis(): bool
    {
        return JsonValue::has($this->entry, 'apis');
    }

    public function document(): ?string
    {
        return JsonValue::string($this->entry, 'document');
    }

    /** @return list<string> */
    public function include(): array
    {
        return JsonValue::strings(JsonValue::object($this->entry, 'operations'), 'include') ?? [];
    }

    /** @return list<string> */
    public function exclude(): array
    {
        return JsonValue::strings(JsonValue::object($this->entry, 'operations'), 'exclude') ?? [];
    }

    /** The entry's `options`, a copy, empty when absent. */
    public function options(): \stdClass
    {
        $options = JsonValue::copy(JsonValue::object($this->entry, 'options'));

        return $options instanceof \stdClass ? $options : new \stdClass();
    }

    /** The entry's `artefacts`, a copy, empty when absent. */
    public function artefacts(): \stdClass
    {
        $artefacts = JsonValue::copy(JsonValue::object($this->entry, 'artefacts'));

        return $artefacts instanceof \stdClass ? $artefacts : new \stdClass();
    }
}
