<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\PromotedParameter;
use Seampact\Ir\Model\Property;

/** A target's own attributes on the promoted members of the generated schema classes, such as validation constraints. */
interface SchemaMemberAttributes
{
    /** Adds the attributes of `$property`, found at `$at` in the IR, to its promoted parameter in `$file`. */
    public function addTo(PromotedParameter $parameter, Property $property, PhpClassFile $file, IrPlace $at): void;
}
