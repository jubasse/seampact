<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\Method;
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
    /** The PHP type of each page fact a paging style reads from the handler (ADR 0002 section 14). */
    private const PAGE_FACT_TYPES = ['nextCursor' => 'string', 'previousCursor' => 'string', 'nextSince' => 'string', 'total' => 'int', 'more' => 'bool'];

    /**
     * @param array<string, string> $nativePageClasses the framework class a handler answers instead of the generated
     *     page, by paging style id (a pack's style the framework pages natively)
     */
    public function __construct(
        private readonly ApiLayout $layout,
        private readonly PhpTypes $types,
        private readonly Refusals $refusals,
        private readonly HandlerAccessTypes $handlerAccess,
        private readonly HandlerAccessPlacement $handlerAccessPlacement,
        private readonly array $nativePageClasses = [],
    )
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
        $constructor = (new Method('__construct'))->setPublic();
        foreach ($inputMembers as $part => $type) {
            PhpTypes::promote($constructor, $part, $type);
        }
        if ($operation->input !== null) {
            PhpTypes::promote($constructor, 'body', $this->types->of($operation->input->schema, $input));
        }
        $handlerAccessMembers = $this->handlerAccessPlacement === HandlerAccessPlacement::Input
            ? $this->handlerAccess->promoteOnInput($constructor, $input, $operation, $names)
            : [];
        if ($constructor->getParameters() !== []) {
            $inputClass->addMember($constructor);
            HandlerAccessTypes::addInputAccessors($inputClass, $constructor, $handlerAccessMembers);
            // A signed route's body is the signed payload, redacted whole (ADR 0023 "Redaction"); who is calling may
            // hold sensitive data, so it is redacted too.
            $bodyRedacted = $operation->input !== null && ($operation->input->rawBody || RedactedMembers::isSensitive($operation->input->schema));
            RedactedMembers::redact($inputClass, $constructor, [...($bodyRedacted ? ['body'] : []), ...$handlerAccessMembers]);
        }
        $files[] = $input;

        $scopesFile = $this->handlerAccess->scopesFile($operation, $names, $at);
        if ($scopesFile !== null) {
            $files[] = $scopesFile;
        }

        $result = new PhpClassFile($names->result);
        $result->namespace->addInterface($result->shortName)
            ->addComment("What the handler of operation '{$operation->id}' returns: a declared success, or a declared error.");
        $files[] = $result;

        foreach ($operation->responses as $index => $response) {
            $files[] = $this->responseFile($names, $response, $operation, $at->below('responses', $index));
        }
        if ($names->page !== null && $this->nativePageClass($operation) === null) {
            $files[] = $this->pageFile($names->page, $operation, $at);
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
        $sensitive = [];

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
            if (RedactedMembers::isSensitive($param->type)) {
                $sensitive[] = $member;
            }
        }
        RedactedMembers::redact($class, $constructor, $sensitive);

        return $file;
    }

    private function responseFile(OperationNames $names, Response $response, Operation $operation, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($names->responses[$response->status]);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addImplement($names->result);
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
        if ($response->shape->value === ResponseShape::Page) {
            if ($names->page === null) {
                $this->refusals->inconsistent('response.page.unpaged', "A 'page' response on an operation without paging", $at);

                return $file;
            }
            $nativePage = $this->nativePageClass($operation);
            $body = $nativePage === null
                ? new PhpType($names->page, PhpClassFile::shortNameOf($file->name($names->page)))
                : new PhpType($nativePage, PhpClassFile::shortNameOf($file->name($nativePage)) . "<int, {$body->doc}>");
        }
        $constructor = $class->addMethod('__construct');
        PhpTypes::promote($constructor, 'body', $body);
        RedactedMembers::redact($class, $constructor, RedactedMembers::isSensitive($response->body) ? ['body'] : []);

        return $file;
    }

    private function nativePageClass(Operation $operation): ?string
    {
        return $this->nativePageClasses[$operation->paging->style ?? ''] ?? null;
    }

    /**
     * The page a paged list's handler returns: its items and the facts its paging style reads from the handler
     * (`handlerResult`), each optional, which the boundary renders into the style's body, headers and links.
     */
    private function pageFile(string $className, Operation $operation, IrPlace $at): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addComment("The page operation '{$operation->id}' answers: its items and the facts its paging style reads.");
        $constructor = $class->addMethod('__construct');

        $item = null;
        foreach ($operation->responses as $response) {
            if ($response->shape->value === ResponseShape::Page && $response->body !== null) {
                $item = $this->types->of($response->body, $file);
            }
        }
        PhpTypes::promote($constructor, 'items', new PhpType('array', 'list<' . ($item->doc ?? 'mixed') . '>'));

        $style = $this->layout->ir->pagings[$operation->paging->style ?? ''] ?? null;
        if ($style === null) {
            $this->refusals->inconsistent('paging.style.undeclared', "The paging style '" . ($operation->paging->style ?? '') . "' is not declared", $at->below('paging', 'style'));

            return $file;
        }
        foreach ($style->handlerResult as $member) {
            $type = self::PAGE_FACT_TYPES[$member->value] ?? null;
            if ($type === null) {
                $this->refusals->waiting('paging.handlerResult', "The page fact '{$member->value}'", $at->below('paging', 'style'), Delivery::AfterOneZero);
                continue;
            }
            $constructor->addPromotedParameter($member->value)->setType($type)->setNullable()->setDefaultValue(null);
        }

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
