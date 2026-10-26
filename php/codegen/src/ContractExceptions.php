<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\ErrorDecl;

/**
 * The exceptions a handler throws (ADR 0012 "Errors the handler answers"): an abstract base per api, implementing the
 * interfaces the target names (Laravel's `ShouldntReport`), and one final class per declared error code with its
 * code, status and params.
 */
final class ContractExceptions
{
    /** @param list<string> $baseInterfaces the interfaces the api's exception base implements, fully qualified */
    public function __construct(private readonly ApiLayout $layout, private readonly OperationTypes $operationTypes, private readonly array $baseInterfaces = [])
    {
    }

    /** @return list<PhpClassFile> */
    public function files(KeptForms $kept): array
    {
        $base = new PhpClassFile($this->layout->contractException);
        $baseClass = $base->namespace->addClass($base->shortName)->setAbstract()
            ->setExtends(\RuntimeException::class);
        foreach ($this->baseInterfaces as $interface) {
            $baseClass->addImplement($interface);
            $base->name($interface);
        }
        $baseClass->addComment("A declared error of api '{$this->layout->ir->api->id}', thrown by a handler.");
        $baseClass->addMethod('contractCode')->setAbstract()->setReturnType('string');
        $baseClass->addMethod('status')->setAbstract()->setReturnType('int');
        $files = [$base];

        foreach ($kept->errors() as $code => $error) {
            $className = $this->layout->errorClass($code);
            if ($className !== null) {
                $files[] = $this->errorFile($className, $code, $error);
            }
        }

        return $files;
    }

    private function errorFile(string $className, string $code, ErrorDecl $error): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setExtends($this->layout->contractException);
        $file->name($this->layout->contractException);
        $class->addComment(DocComments::of($error->docs, "The error '{$code}'."));
        $class->addConstant('CODE', $code)->setPublic();
        $class->addConstant('STATUS', $error->http->status)->setPublic();

        $constructor = $class->addMethod('__construct');
        $paramsClass = $this->operationTypes->paramsClassOf($code);
        if ($paramsClass !== null) {
            $file->name($paramsClass);
            $constructor->addPromotedParameter('params')->setType($paramsClass)->setReadOnly();
        }
        $constructor->setBody('parent::__construct(self::CODE);');

        $class->addMethod('contractCode')->setReturnType('string')->setBody('return self::CODE;');
        $class->addMethod('status')->setReturnType('int')->setBody('return self::STATUS;');

        return $file;
    }
}
