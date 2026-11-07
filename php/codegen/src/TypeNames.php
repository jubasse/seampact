<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** The PHP class a target writes for each kept schema and enum, null for one it does not write. */
interface TypeNames
{
    public function schemaClass(string $schemaId): ?string;

    public function enumClass(string $enumId): ?string;
}
