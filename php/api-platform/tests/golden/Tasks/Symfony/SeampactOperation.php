<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Symfony\Runtime\OperationMark;

/**
 * Marks a controller method as the handler of one operation of api 'tasks'.
 */
#[\Attribute(\Attribute::TARGET_METHOD)]
final readonly class SeampactOperation extends OperationMark
{
}
