<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * A bundle another ecosystem's registry serves: an npm `package` with its `version`, or a `maven` artefact. A PHP
 * build reads neither registry, so the fetcher refuses it by name, naming the release and git forms of the bundle.
 */
final readonly class RegistrySource implements BundleSource
{
    public const NPM = 'package';
    public const MAVEN = 'maven';

    /** @param self::NPM|self::MAVEN $registry */
    public function __construct(public string $registry, public string $name, private ?string $integrity)
    {
    }

    public function integrity(): ?string
    {
        return $this->integrity;
    }

    public function describe(): string
    {
        return $this->registry === self::NPM ? "package '{$this->name}'" : "Maven artefact '{$this->name}'";
    }
}
