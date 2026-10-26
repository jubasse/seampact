<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** What a `YamlToken` is: a plain scalar in a value, a plain scalar used as a mapping key, or a tag. */
enum YamlTokenKind
{
    case Scalar;
    case Key;
    case Tag;
}
