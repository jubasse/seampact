<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\PhpClassFile;

/**
 * The api's input value resolver (ADR 0024 "Placement"), tagged `controller.argument_value_resolver` at priority 150:
 * for a parameter typed with one of the api's input classes it returns the checked input the boundary stored in the
 * request, and nothing else. A request that never passed the boundary has none stored, which is refused.
 */
final class InputResolverFile
{
    public function __construct(private readonly SymfonyPlacement $placement)
    {
    }

    public function file(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->inputResolver);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->addImplement($file->type('Symfony\\Component\\HttpKernel\\Controller\\ValueResolverInterface'))
            ->addComment("Hands each contract handler the input the boundary checked for its operation.");
        $class->addConstant('INPUT_ATTRIBUTE', "_seampact_{$this->placement->apiKey}_input");
        $class->addConstant('PRIORITY', 150);

        $inputs = [];
        foreach ($this->placement->operations() as [, $operation]) {
            $inputs[] = $file->name($this->placement->names($operation->id)->input) . '::class';
        }
        $class->addConstant('INPUT_CLASSES', new Literal('[' . implode(', ', $inputs) . ']'))->setPrivate();

        $resolve = $class->addMethod('resolve')->setPublic()->setReturnType('iterable')
            ->addComment('@return list<object>');
        $resolve->addParameter('request')->setType($file->type('Symfony\\Component\\HttpFoundation\\Request'));
        $resolve->addParameter('argument')->setType($file->type('Symfony\\Component\\HttpKernel\\ControllerMetadata\\ArgumentMetadata'));
        $bypassed = $file->name($this->placement->runtime('ContractBypassedException'));
        $resolve->setBody(<<<PHP
            \$type = \$argument->getType();
            if (\$type === null || !in_array(\$type, self::INPUT_CLASSES, true)) {
                return [];
            }

            \$input = \$request->attributes->get(self::INPUT_ATTRIBUTE);
            if (!\$input instanceof \$type) {
                throw new {$bypassed}("The handler parameter '{\$argument->getName()}' takes the contract input {\$type}, but no checked input of that operation is stored: the request did not pass the boundary, as a sub-request from forward() or a direct call does.");
            }

            return [\$input];
            PHP);

        return $file;
    }
}
