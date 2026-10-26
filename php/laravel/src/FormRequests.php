<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Model\Operation;

/**
 * The FormRequest of each operation (ADR 0023 "Types and validation"): `authorize()` fails closed unless the access
 * middleware marked the request for this operation, `validationData()` is the boundary's decoded input with every
 * wire name escaped, and `rules()` holds the operation's rules, which `contractRules()` builds over an input tree.
 */
final class FormRequests
{
    private const FORM_REQUEST = 'Illuminate\\Foundation\\Http\\FormRequest';

    public function __construct(private readonly PhpLayout $layout, private readonly RulesMode $mode, private readonly Refusals $refusals)
    {
    }

    public function file(Operation $operation, OperationNames $names, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($names->request);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setExtends(self::FORM_REQUEST);
        $file->name(self::FORM_REQUEST);
        $class->addComment("The request of operation '{$operation->id}': its access mark and its validation rules.");
        $class->addConstant('API', $this->layout->ir->api->id)->setPublic();
        $class->addConstant('OPERATION_ID', $operation->id)->setPublic();

        $rules = new MemberRules($this->layout, $this->mode, $file, $this->refusals);
        foreach (['path' => $operation->params->path, 'query' => $operation->params->query, 'headers' => KeptForms::handlerHeaders($operation)] as $part => $params) {
            foreach ($params as $index => $param) {
                $rules->param($part, $param, $at->below('params', $part === 'headers' ? 'header' : $part, $index));
            }
        }
        if ($operation->input !== null) {
            $rules->body($operation->input->schema, $at->below('input', 'schema'));
        }

        $class->addConstant('NATIVE_RULE_NAMES', $rules->nativeNames)->setPublic()
            ->addComment("Laravel's own rules on each attribute, by the name `failed()` gives, and the contract rule each one checks.");

        $mark = $file->name($this->layout->runtime('BoundaryMark'));
        $tree = $file->name($this->layout->runtime('InputTree'));

        $class->addMethod('authorize')->setReturnType('bool')
            ->setBody("{$mark}::assertMarked(\$this, self::API, self::OPERATION_ID);\n\nreturn true;");

        $class->addMethod('validationData')->setReturnType('array')
            ->addComment('@return array<string, mixed>')
            ->setBody("return {$tree}::of(\$this, self::API)->validationData();");

        $class->addMethod('rules')->setReturnType('array')
            ->addComment('@return array<string, list<mixed>>')
            ->setBody("return self::contractRules({$tree}::of(\$this, self::API));");

        $contractRules = $class->addMethod('contractRules')->setStatic()->setReturnType('array')
            ->addComment('@return array<string, list<mixed>>')
            ->setBody('return ?;', [new Literal(self::rulesArray($rules->rules))]);
        $contractRules->addParameter('input')->setType($this->layout->runtime('InputTree'));

        return $file;
    }

    /** @param array<string, list<string>> $rules */
    private static function rulesArray(array $rules): string
    {
        if ($rules === []) {
            return '[]';
        }

        $lines = [];
        foreach ($rules as $key => $expressions) {
            $lines[] = "\t" . var_export($key, true) . " => [\n\t\t" . implode(",\n\t\t", $expressions) . ",\n\t],";
        }

        return "[\n" . implode("\n", $lines) . "\n]";
    }
}
