<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\HandlerAccessTypes;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpNames;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RulesMode;
use Seampact\Ir\Model\InputProof;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\RefuseUnknownQuery;

/**
 * The FormRequest of each operation (ADR 0023 "Types and validation"): `authorize()` fails closed unless the access
 * middleware marked the request for this operation, `validationData()` is the boundary's decoded input with every
 * wire name escaped, and `rules()` holds the operation's rules, which `contractRules()` builds over an input tree;
 * under `unknownQuery: refuse` an undeclared query key is an issue. `forTest()` builds an admitted request for a
 * unit test that calls the handler directly.
 */
final class FormRequests
{
    private const FORM_REQUEST = 'Illuminate\\Foundation\\Http\\FormRequest';
    private const VALIDATOR = 'Illuminate\\Contracts\\Validation\\Validator';

    public function __construct(
        private readonly PhpLayout $layout,
        private readonly RulesMode $mode,
        private readonly Refusals $refusals,
    ) {
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
        $this->handlerAccess($file, $operation, $this->layout->operation($operation->id) ?? throw new \LogicException("The operation '{$operation->id}' has no names."));

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

    // Who is calling: read from the boundary state of this api, never from the wire input (ADR 0012 "Open tenancy").
    private function handlerAccess(PhpClassFile $file, Operation $operation, OperationNames $names): void
    {
        $class = LaravelReplies::classOf($file);
        $state = "{$file->name($this->layout->runtime('BoundaryState'))}::required(\$this, self::API)";

        $principalClass = HandlerAccessTypes::principalClass($this->layout, $operation);
        if ($principalClass !== null) {
            $anonymous = HandlerAccessTypes::anonymousAllowed($operation);
            $read = $anonymous ? 'principal' : 'authenticatedPrincipal';
            $access = $file->name($this->layout->runtime('HandlerAccess'));
            $principal = $file->name($principalClass);
            $class->addMethod('principal')->setReturnType($file->type($principalClass))->setReturnNullable($anonymous)
                ->addComment($anonymous ? 'The caller, null for an anonymous caller.' : 'The caller.')
                ->setBody("return {$access}::{$read}({$state}, self::OPERATION_ID, {$principal}::class);");
        }

        if ($names->scopes !== null) {
            $access = $file->name($this->layout->runtime('HandlerAccess'));
            $scopes = $file->name($names->scopes);
            $class->addMethod('scopes')->setReturnType($file->type($names->scopes))
                ->addComment('The scopes the operation runs in, as their resolvers resolved them.')
                ->setBody("return {$access}::scopes({$state}, self::OPERATION_ID, {$scopes}::class);");
        }

        $this->forTest($file, $operation, $names, $principalClass);
    }

    // A unit test's direct handler call: the request holds an admitted state with the input, caller and scopes given.
    private function forTest(PhpClassFile $file, Operation $operation, OperationNames $names, ?string $principalClass): void
    {
        $method = LaravelReplies::classOf($file)->addMethod('forTest')->setStatic()->setReturnType('self')
            ->addComment('A request for a unit test that calls the handler directly, never served: the handler reads the input, the caller')
            ->addComment('and the scopes given here.');
        $method->addParameter('input')->setType($file->type($names->input));

        $principal = 'null';
        if ($principalClass !== null) {
            $method->addParameter('principal')->setType($file->type($principalClass))->setNullable(HandlerAccessTypes::anonymousAllowed($operation));
            $principal = '$principal';
        }

        $scopes = [];
        if ($names->scopes !== null) {
            $method->addParameter('scopes')->setType($file->type($names->scopes));
            foreach ($operation->scopes as $scope) {
                // A scope without a name segment is refused where the scopes class is written.
                $member = PhpNames::memberIdentifier($scope->scope);
                if ($member !== null) {
                    $scopes[] = "\$scopes->{$member}()";
                }
            }
        }

        $testRequest = $file->name($this->layout->runtime('HandlerTestRequest'));
        $contract = $file->name($this->layout->contract);
        $method->setBody("return {$testRequest}::admitted(new self(), {$contract}::class, self::OPERATION_ID, \$input, {$principal}, [" . implode(', ', $scopes) . ']);');
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
