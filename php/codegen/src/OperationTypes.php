<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\Response;
use Seampact\Ir\Model\ResponseShape;

/**
 * The types of each operation (ADR 0023 "Placement"): its input, made of the path, query, header and body parts it
 * declares; its result interface, implemented by one final class per declared success status and by the typed
 * errors class (ADR 0007 `errors` role), which holds one factory per code the operation lists.
 */
final class OperationTypes
{
    public function __construct(private readonly ApiLayout $layout, private readonly PhpTypes $types, private readonly Refusals $refusals)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(Operation $operation, OperationNames $names, IrPlace $at): array
    {
        $parts = [
            'path' => [$names->path, $operation->params->path],
            'query' => [$names->query, $operation->params->query],
            'headers' => [$names->headers, KeptForms::handlerHeaders($operation)],
        ];
        $files = [];
        $inputMembers = [];

        foreach ($parts as $part => [$className, $params]) {
            if ($params !== []) {
                $files[] = $this->paramsFile($className, $part, $params, $operation, $at);
                $inputMembers[$part] = new PhpType($className, PhpClassFile::shortNameOf($className));
            }
        }

        $input = new PhpClassFile($names->input);
        $inputClass = $input->namespace->addClass($input->shortName)->setFinal()->setReadOnly();
        $inputClass->addComment("The input of operation '{$operation->id}', as its handler reads it.");
        if ($inputMembers !== [] || $operation->input !== null) {
            $constructor = $inputClass->addMethod('__construct');
            foreach ($inputMembers as $part => $type) {
                PhpTypes::promote($constructor, $part, $type);
            }
            if ($operation->input !== null) {
                PhpTypes::promote($constructor, 'body', $this->types->of($operation->input->schema, $input));
            }
        }
        $files[] = $input;

        $result = new PhpClassFile($names->result);
        $result->namespace->addInterface($result->shortName)
            ->addComment("What the handler of operation '{$operation->id}' returns: a declared success, or a declared error.");
        $files[] = $result;

        foreach ($operation->responses as $index => $response) {
            $files[] = $this->responseFile($names->responses[$response->status], $names->result, $response, $operation, $at->below('responses', $index));
        }

        $files[] = $this->errorsFile($names, $operation);

        return $files;
    }

    /** @param list<Param> $params */
    private function paramsFile(string $className, string $part, array $params, Operation $operation, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addComment("The {$part} parameters of operation '{$operation->id}'.");
        $constructor = $class->addMethod('__construct');
        $irPart = $part === 'headers' ? 'header' : $part;

        $members = [];

        foreach ($params as $index => $param) {
            $paramAt = $at->below('params', $irPart, $index);
            $member = PhpNames::memberIdentifier($param->name);
            if ($member === null) {
                $this->refusals->inconsistent('param.no-segment', "The parameter '{$param->name}' yields no name segment", $paramAt);
                continue;
            }

            $claimed = $members[strtolower($member)] ?? null;
            if ($claimed !== null) {
                $this->refusals->add('name.collision', "The property '\${$member}' would be written for both '{$claimed}' and '{$param->name}' of the {$part} parameters of operation '{$operation->id}'.", 'Rename one of the parameters in the contract.', $paramAt);
                continue;
            }

            $members[strtolower($member)] = $param->name;
            PhpTypes::promote($constructor, $member, $this->types->ofParam($param, $file));
        }

        return $file;
    }

    private function responseFile(string $className, string $resultInterface, Response $response, Operation $operation, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addImplement($resultInterface);
        $class->addComment(DocComments::of($response->docs, "The {$response->status} reply of operation '{$operation->id}'."));

        if ($response->body === null) {
            if ($response->shape->value !== ResponseShape::Empty) {
                $this->refusals->inconsistent('response.body.missing', "A '{$response->shape->value}' response has no body", $at);
            }

            return $file;
        }

        $body = $this->types->of($response->body, $file);
        if ($response->shape->value === ResponseShape::Table) {
            $body = new PhpType('array', "array<string, {$body->doc}>");
        }
        PhpTypes::promote($class->addMethod('__construct'), 'body', $body);

        return $file;
    }

    private function errorsFile(OperationNames $names, Operation $operation): PhpClassFile
    {
        $file = new PhpClassFile($names->errors);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addImplement($names->result);
        $class->addComment("A declared error of operation '{$operation->id}', returned by its handler instead of thrown.");
        $constructor = $class->addMethod('__construct')->setPrivate();
        $constructor->addPromotedParameter('code')->setType('string');
        $constructor->addPromotedParameter('params')->setType('object')->setNullable();

        $listed = [];
        foreach ($operation->errors as $error) {
            $factory = $this->layout->errorFactory($error->code);
            if ($factory === null || isset($listed[$error->code])) {
                continue;
            }
            $listed[$error->code] = true;

            $method = $class->addMethod($factory)->setStatic()->setReturnType('self');
            $paramsClass = $this->paramsClassOf($error->code);
            if ($paramsClass === null) {
                $method->setBody('return new self(?, null);', [$error->code]);
                continue;
            }
            $method->addParameter('params')->setType($paramsClass);
            $file->name($paramsClass);
            $method->setBody('return new self(?, $params);', [$error->code]);
        }

        return $file;
    }

    public function paramsClassOf(string $code): ?string
    {
        $paramsSchema = $this->layout->ir->errors[$code]->params ?? null;

        return $paramsSchema === null ? null : $this->layout->schemaClass($paramsSchema);
    }
}
