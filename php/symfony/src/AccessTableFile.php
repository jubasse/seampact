<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\AccessKind;
use Seampact\Codegen\PhpClassFile;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OperationScope;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\RightRequirement;
use Seampact\Ir\Model\RuleRequirement;

/**
 * The api's access table (ADR 0024 "Native security layers"), keyed by route name, for the app's `access_control`
 * rules and voters: each operation's access kind, identity, the rights and rules it requires and the scopes it
 * resolves. The per-kind request matchers read the kind from it.
 */
final class AccessTableFile
{
    public function __construct(private readonly SymfonyPlacement $placement)
    {
    }

    public function file(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->access);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->addComment("The access of each contract route of api '{$this->placement->apiKey}', keyed by route name. The kind is the one\n"
                . 'the request matcher service `seampact.' . $this->placement->layout->ir->api->id . '.matcher.<kind>` matches.');

        $routes = [];
        foreach ($this->placement->operations() as [, $operation]) {
            $routes["seampact.{$this->placement->layout->ir->api->id}.{$operation->id}"] = $this->row($operation);
        }
        $class->addConstant('KINDS', AccessKind::ALL)->addComment('@var list<string>');
        $class->addConstant('ROUTES', $routes)
            ->addComment('@var array<string, array{operation: string, kind: string, identity: ?string, rights: list<string>, rules: list<string>, scopes: list<string>}>');

        return $file;
    }

    /** @return array{operation: string, kind: string, identity: ?string, rights: list<string>, rules: list<string>, scopes: list<string>} */
    private function row(Operation $operation): array
    {
        $access = $operation->access;
        $rights = [];
        $rules = [];
        foreach ($operation->requires as $requirement) {
            if ($requirement instanceof RightRequirement) {
                $rights[] = $requirement->right;
            } elseif ($requirement instanceof RuleRequirement) {
                $rules[] = $requirement->rule;
            } else {
                throw new \LogicException("The requirement '{$requirement->tag()}' of operation '{$operation->id}' was not refused.");
            }
        }

        return [
            'operation' => $operation->id,
            'kind' => AccessKind::of($this->placement->layout->ir, $operation),
            'identity' => $access instanceof IdentityAccess || $access instanceof OptionalAccess ? $access->identity : null,
            'rights' => $rights,
            'rules' => $rules,
            'scopes' => array_map(static fn (OperationScope $scope): string => $scope->scope, $operation->scopes),
        ];
    }
}
