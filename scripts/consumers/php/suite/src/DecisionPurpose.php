<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

use Seampact\Hooks\Purpose;

/** The purpose of a decide request as the loaded script names it. */
final class DecisionPurpose
{
    private function __construct()
    {
    }

    public static function name(Purpose $purpose): string
    {
        return match (true) {
            $purpose instanceof Purpose\Route => 'route',
            $purpose instanceof Purpose\Field => 'field',
            $purpose instanceof Purpose\SortKey => 'sortKey',
            default => throw new \UnexpectedValueException('the decide request has the unknown purpose ' . $purpose::class),
        };
    }
}
