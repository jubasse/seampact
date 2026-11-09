<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\ApiPlatform\Runtime\ReplyDecorator;
use Seampact\Codegen\PhpClassFile;
use Seampact\Symfony\BundleWiredClass;

/**
 * The api's decorator of API Platform's main state processor (ADR 0029 "The reply path"): it names the api's contract
 * class and id, and the runtime base writes the reply of a generated result.
 */
final class ReplyDecoratorFile
{
    public function __construct(private readonly ApiPlatformPlacement $names)
    {
    }

    public function file(): PhpClassFile
    {
        $placement = $this->names->placement;
        $file = new PhpClassFile($this->names->replyDecoratorClass);
        $class = BundleWiredClass::excludeFromResourceLoading($file, $file->namespace->addClass($file->shortName))->setFinal()
            ->setExtends($file->type(ReplyDecorator::class))
            ->addComment("Writes the contract reply of api '{$placement->apiKey}' for a generated result, between API Platform's write and serialize steps.");

        $class->addMethod('contractClass')->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($placement->contract) . '::class;');
        $class->addMethod('apiId')->setProtected()->setReturnType('string')
            ->setBody('return ' . var_export($placement->layout->ir->api->id, true) . ';');

        return $file;
    }
}
