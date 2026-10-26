<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\TypeNames;

/** Every schema and enum as a class of `App\Types`. */
final class AppTypeNames implements TypeNames
{
    public const NAMESPACE = 'App\\Types';

    public function schemaClass(string $schemaId): string
    {
        return self::NAMESPACE . '\\' . $schemaId;
    }

    public function enumClass(string $enumId): string
    {
        return self::NAMESPACE . '\\' . $enumId;
    }
}
