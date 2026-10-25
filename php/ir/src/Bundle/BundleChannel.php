<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** How a bundle was fetched: an npm package root may also hold npm's own files (`package.json`, `README*`...). */
enum BundleChannel: string
{
    case Package = 'package';
    case Release = 'release';
    case Git = 'git';
}
