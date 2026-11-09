<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\PhpClassFile;
use Seampact\Ir\Model\Operation;
use Seampact\Symfony\BundleWiredClass;

/**
 * The processor of one operation (ADR 0029 "Placement"): API Platform runs it after the boundary admitted the request,
 * and it hands the typed input the boundary stored to the developer's handler, which the endpoints interface names.
 */
final class ProcessorFile
{
    public function __construct(private readonly ApiPlatformPlacement $names)
    {
    }

    public function file(Operation $operation): PhpClassFile
    {
        $placement = $this->names->placement;
        $operationNames = $placement->names($operation->id);
        $file = new PhpClassFile($this->names->processorClass($operation->id));
        $class = BundleWiredClass::excludeFromResourceLoading($file, $file->namespace->addClass($file->shortName))->setFinal()
            ->setExtends($file->type(OperationProcessor::class))
            ->addComment("Runs the handler of operation '{$operation->id}' for API Platform, on the input the boundary checked.");

        $constructor = $class->addMethod('__construct')->setPublic();
        $constructor->addPromotedParameter('handler')->setPrivate()->setReadOnly()->setType($operationNames->endpoints);
        $file->name($operationNames->endpoints);

        $class->addMethod('operationId')->setProtected()->setReturnType('string')
            ->setBody('return ' . var_export($operation->id, true) . ';');
        $class->addMethod('apiId')->setProtected()->setReturnType('string')
            ->setBody('return ' . var_export($placement->layout->ir->api->id, true) . ';');
        $class->addMethod('inputAttribute')->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($placement->inputResolver) . '::INPUT_ATTRIBUTE;');

        $handle = $class->addMethod('handle')->setProtected()->setReturnType('object');
        $handle->addParameter('input')->setType('object');
        $input = $file->name($operationNames->input);
        $handle->setBody(<<<PHP
            if (!\$input instanceof {$input}) {
                throw new {$file->name($placement->runtime('ContractBypassedException'))}("The processor of operation '{$operation->id}' got no checked input of that operation.");
            }

            return \$this->handler->{$operationNames->method}(\$input);
            PHP);

        return $file;
    }
}
