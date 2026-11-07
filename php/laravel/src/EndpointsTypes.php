<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\DocComments;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\PhpClassFile;

/**
 * The controller interface of each resource (ADR 0007 `handlers: perResource`): one method per operation, taking its
 * FormRequest, returning its result and declaring the exception of every code it lists.
 */
final class EndpointsTypes
{
    public function __construct(private readonly PhpLayout $layout)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(KeptForms $kept): array
    {
        $files = [];

        foreach ($kept->operations() as [, $operation]) {
            $names = $this->layout->operation($operation->id);
            if ($names === null) {
                continue;
            }

            if (!isset($files[$names->endpoints])) {
                $file = new PhpClassFile($names->endpoints);
                $file->namespace->addInterface($file->shortName)
                    ->addComment('The handlers a controller implements; each returns a declared success or error, or throws a declared error.');
                $files[$names->endpoints] = $file;
            }

            $file = $files[$names->endpoints];
            $interface = $file->namespace->getClasses()[$file->shortName];
            $method = $interface->addMethod($names->method)->setPublic()->setReturnType($names->result);
            $request = $this->layout->request($operation->id);
            $method->addParameter('request')->setType($request);
            $file->name($request);
            $file->name($names->result);
            $method->addComment(DocComments::of($operation->docs, "Operation '{$operation->id}'."));

            $thrown = [];
            foreach ($operation->errors as $error) {
                $exception = $this->layout->errorClass($error->code);
                if ($exception !== null && !isset($thrown[$exception])) {
                    $thrown[$exception] = true;
                    $method->addComment('@throws ' . $file->name($exception));
                }
            }
        }

        return array_values($files);
    }
}
