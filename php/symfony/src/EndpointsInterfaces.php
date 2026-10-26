<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\PhpClassFile;


/**
 * The controller interfaces in their Symfony form (ADR 0024 "Placement"): one per resource, each method taking the
 * operation's input, which the value resolver hands over, and returning its result; the errors it may throw are
 * declared with `@throws`. The developer's controller service implements it and marks each method with the attribute.
 */
final class EndpointsInterfaces
{
    public function __construct(private readonly SymfonyPlacement $placement)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        $files = [];

        foreach ($this->placement->operations() as [, $operation]) {
            $names = $this->placement->names($operation->id);

            if (!isset($files[$names->endpoints])) {
                $file = new PhpClassFile($names->endpoints);
                $file->namespace->addInterface($file->shortName)->addComment(
                    "The handlers a controller service implements, each method marked with the SeampactOperation\n"
                    . 'attribute of its operation; each returns a declared success or error, or throws a declared error.',
                );
                $files[$names->endpoints] = $file;
            }

            $file = $files[$names->endpoints];
            $interface = $file->namespace->getClasses()[$file->shortName];
            $method = $interface->addMethod($names->method)->setPublic()->setReturnType($names->result);
            $method->addParameter('input')->setType($names->input);
            $file->name($names->input);
            $file->name($names->result);
            $method->addComment("Operation '{$operation->id}'.");

            $thrown = [];
            foreach ($operation->errors as $error) {
                $exception = $this->placement->layout->errorClass($error->code);
                if ($exception !== null && !isset($thrown[$exception])) {
                    $thrown[$exception] = true;
                    $method->addComment('@throws ' . $file->name($exception));
                }
            }
        }

        return array_values($files);
    }
}
