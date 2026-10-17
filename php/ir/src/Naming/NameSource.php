<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** Where a written name comes from; it decides what a name without any segment means (ADR 0007 section 2). */
enum NameSource: string
{
    case Name = 'name';
    case EnumValue = 'enumValue';
    case Right = 'right';
}
