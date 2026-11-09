<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests\Support;

use Seampact\Symfony\Runtime\OperationMark;

/** A stand-in for an api's generated `SeampactOperation` attribute. */
#[\Attribute(\Attribute::TARGET_METHOD)]
final readonly class HandlerMark extends OperationMark
{
}
