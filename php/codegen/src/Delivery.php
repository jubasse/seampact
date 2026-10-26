<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** When a form this release refuses gets generated (ADR 0022 and 0023 "Refused by name or waiting"). */
enum Delivery
{
    case ContractNeed;
    case Consumer;
    case AfterOneZero;

    public function description(): string
    {
        return match ($this) {
            self::ContractNeed => 'it waits for a contract that needs it',
            self::Consumer => 'it waits for an app that needs it',
            self::AfterOneZero => 'no reference contract carries it, so it waits for a consumer after 1.0',
        };
    }
}
