<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\ClassType;
use Seampact\Codegen\PhpClassFile;

/**
 * A generated class the api's bundle registers itself, marked `#[Exclude]`: an app's resource import, such as the
 * skeleton's `App\: resource: '../src/'`, then skips it, so its autowired definition never replaces the bundle's.
 */
final class BundleWiredClass
{
    private const EXCLUDE_ATTRIBUTE = 'Symfony\\Component\\DependencyInjection\\Attribute\\Exclude';

    public static function excludeFromResourceLoading(PhpClassFile $file, ClassType $class): ClassType
    {
        return $class->addAttribute($file->type(self::EXCLUDE_ATTRIBUTE));
    }
}
