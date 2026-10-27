<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\ApiInterfaceFile;
use Seampact\Codegen\PhpClassFile;

/**
 * The classes Symfony matches by type, generated per api over the shared runtime (ADR 0025 "The runtime packages"):
 * the `SeampactOperation` attribute the boundary reads, and the decider, scope resolver and unexpected-error listener
 * interfaces the bundle autoconfigures or looks up, so one api never runs another's handlers, hooks or listener.
 */
final class ApiIdentityFiles
{
    public function __construct(private readonly SymfonyPlacement $placement)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        $api = $this->placement->apiKey;

        return [
            $this->operationAttribute(),
            ApiInterfaceFile::extending($this->placement->decider, $this->placement->runtime('Decider'), "A decider of api '{$api}': implement it, with autoconfiguration on."),
            ApiInterfaceFile::extending($this->placement->scopeResolver, $this->placement->runtime('ScopeResolver'), "A scope resolver of api '{$api}': implement it, with autoconfiguration on."),
            ApiInterfaceFile::extending(
                $this->placement->unexpectedErrorListener,
                $this->placement->runtime('UnexpectedErrorListener'),
                "Told of every failure api '{$api}' answers with its 500: alias this interface to your listener.",
            ),
        ];
    }

    private function operationAttribute(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->operationAttribute);
        $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly()
            ->setExtends($file->type($this->placement->runtime('OperationMark')))
            ->addAttribute('Attribute', [new Literal('\Attribute::TARGET_METHOD')])
            ->addComment("Marks a controller method as the handler of one operation of api '{$this->placement->apiKey}'.");

        return $file;
    }
}
