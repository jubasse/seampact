<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RulesMode;
use Seampact\Ir\Model\InputProof;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\RefuseUnknownQuery;

/**
 * The FormRequest of each operation (ADR 0023 "Types and validation"): `authorize()` fails closed unless the access
 * middleware marked the request for this operation, `validationData()` is the boundary's decoded input with every
 * wire name escaped, and `rules()` holds the operation's rules, which `contractRules()` builds over an input tree;
 * under `unknownQuery: refuse` an undeclared query key is an issue.
 */
final class FormRequests
{
    private const FORM_REQUEST = 'Illuminate\\Foundation\\Http\\FormRequest';
    private const VALIDATOR = 'Illuminate\\Contracts\\Validation\\Validator';

    public function __construct(private readonly PhpLayout $layout, private readonly RulesMode $mode, private readonly Refusals $refusals)
    {
    }

    public function file(Operation $operation, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($this->layout->request($operation->id));
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
        if ($operation->unknownQuery instanceof RefuseUnknownQuery) {
            $rules->refuseUnknownQuery($operation->params->query);
        }
        if ($operation->input !== null) {
            $proofNames = array_map(static fn (InputProof $proof): string => $proof->name, $operation->input->proofs ?? []);
            $rules->body($operation->input->schema, $proofNames, $at->below('input', 'schema'));
        }

        $class->addConstant('NATIVE_RULE_NAMES', $rules->nativeNames())->setPublic()
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

        $this->contractSteps($file, $operation);

        $contractRules = $class->addMethod('contractRules')->setStatic()->setReturnType('array')
            ->addComment('@return array<string, list<mixed>>')
            ->setBody('return ?;', [new Literal(self::rulesArray($rules->rules()))]);
        $contractRules->addParameter('input')->setType($this->layout->runtime('InputTree'));

        return $file;
    }

    // Steps 6 to 8: a failed validation is the contract's 400, a passed one runs step 7 and builds the typed input.
    private function contractSteps(PhpClassFile $file, Operation $operation): void
    {
        $class = LaravelReplies::classOf($file);
        $formSteps = $file->name($this->layout->runtime('FormSteps'));
        $state = $file->name($this->layout->runtime('BoundaryState'));
        $names = $this->layout->operation($operation->id) ?? throw new \LogicException("The operation '{$operation->id}' has no names.");
        $input = $file->name($names->input);

        $class->addMethod('failedValidation')->setProtected()->setReturnType('never')
            ->setBody("throw {$formSteps}::failed(\$this, self::API, \$validator, self::NATIVE_RULE_NAMES);")
            ->addParameter('validator')->setType($file->type(self::VALIDATOR));

        $class->addMethod('passedValidation')->setProtected()->setReturnType('void')
            ->setBody("{$formSteps}::passed(\$this, self::API);");

        $class->addMethod('contractInput')->setReturnType($file->type($names->input))
            ->addComment('The validated input of the operation, typed.')
            ->setBody("\$input = {$state}::required(\$this, self::API)->contractInput;\n\nreturn \$input instanceof {$input} ? \$input : throw new \\LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');");
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
