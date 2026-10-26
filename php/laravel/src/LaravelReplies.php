<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\ClassType;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\OperationTypes;
use Seampact\Codegen\PhpClassFile;

/**
 * Makes the shared result and exception classes reply through the boundary (ADR 0023 "Results and errors"): each
 * success and errors class is `Responsable`, so Laravel's router hands it to the copied runtime's `Replies::result`,
 * and the api's exception base renders itself with `Replies::thrown`, its params read from `contractParams()`.
 */
final class LaravelReplies
{
    private const RESPONSABLE = 'Illuminate\\Contracts\\Support\\Responsable';
    private const REQUEST = 'Illuminate\\Http\\Request';
    private const RESPONSE = 'Symfony\\Component\\HttpFoundation\\Response';

    public function __construct(private readonly PhpLayout $layout, private readonly OperationTypes $operationTypes)
    {
    }

    /**
     * The operation's result classes, each made `Responsable`.
     *
     * @param list<PhpClassFile> $files the files `OperationTypes` wrote for the operation
     */
    public function results(array $files, OperationNames $names): void
    {
        $results = [...array_values($names->responses), $names->errors];
        foreach ($files as $file) {
            if (in_array($file->className, $results, true)) {
                $this->responsable($file);
            }
        }
    }

    /**
     * The api's exception base, rendering itself, and each error class with params, giving them to it.
     *
     * @param list<PhpClassFile> $files the files `ContractExceptions` wrote
     */
    public function exceptions(array $files, KeptForms $kept): void
    {
        $paramsClasses = [];
        foreach (array_keys($kept->errors()) as $code) {
            $className = $this->layout->errorClass($code);
            $paramsClass = $this->operationTypes->paramsClassOf($code);
            if ($className !== null && $paramsClass !== null) {
                $paramsClasses[$className] = $paramsClass;
            }
        }

        foreach ($files as $file) {
            if ($file->className === $this->layout->api->contractException) {
                $this->renderingBase($file);
            } elseif (isset($paramsClasses[$file->className])) {
                self::classOf($file)->addMethod('contractParams')->setReturnType($file->type($paramsClasses[$file->className]))
                    ->setBody('return $this->params;');
            }
        }
    }

    private function responsable(PhpClassFile $file): void
    {
        $class = self::classOf($file);
        $class->addImplement($file->type(self::RESPONSABLE));
        $replies = $file->name($this->layout->runtime('Replies'));
        $request = $file->name(self::REQUEST);
        $method = $class->addMethod('toResponse')->setReturnType($file->type(self::RESPONSE))
            ->addComment("@param {$request} \$request")
            ->setBody("return {$replies}::result(\$request, ?, \$this);", [$this->layout->ir->api->id]);
        $method->addParameter('request');
    }

    private function renderingBase(PhpClassFile $file): void
    {
        $class = self::classOf($file);
        $replies = $file->name($this->layout->runtime('Replies'));
        $class->addMethod('contractParams')->setReturnType('object')->setReturnNullable()
            ->addComment('The params of the error, null when its code declares none.')
            ->setBody('return null;');
        $class->addMethod('render')->setReturnType($file->type(self::RESPONSE))
            ->addComment('The reply Laravel\'s exception handler writes: the error in the api\'s format.')
            ->setBody("return {$replies}::thrown(\$request, ?, \$this->contractCode(), \$this->contractParams());", [$this->layout->ir->api->id])
            ->addParameter('request')->setType($file->type(self::REQUEST));
    }

    /** The one class a generated file holds. */
    public static function classOf(PhpClassFile $file): ClassType
    {
        $class = $file->namespace->getClasses()[$file->shortName] ?? null;
        if (!$class instanceof ClassType) {
            throw new \LogicException("The generated file of {$file->className} holds no class.");
        }

        return $class;
    }
}
