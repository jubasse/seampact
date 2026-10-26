<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\BootCheckSwitches;
use Nette\PhpGenerator\Literal;
use Seampact\Codegen\PhpClassFile;

/**
 * The api's boundary wiring (ADR 0023 "The boundary"): the boundary and access middleware, each naming the contract
 * class, and the service provider the app lists in `bootstrap/providers.php`, with its boot check switches and the
 * container tags its deciders and scope resolvers take.
 */
final class BoundaryClasses
{
    public function __construct(private readonly PhpLayout $layout, private readonly ?BootCheckSwitches $bootCheck)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        return [
            $this->middlewareFile($this->layout->boundary, 'BoundaryMiddleware', 'steps 1 and 10 of every request under its base paths'),
            $this->middlewareFile($this->layout->accessMiddleware, 'AccessMiddleware', 'steps 2 to 5 of each contract route'),
            $this->providerFile(),
        ];
    }

    private function middlewareFile(string $className, string $runtimeBase, string $role): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setExtends($file->type($this->layout->runtime($runtimeBase)));
        $class->addComment("The {$runtimeBase} of api '{$this->layout->ir->api->id}': {$role}.");
        $this->contractMethod($file, 'contractClass', $this->layout->contract);

        return $file;
    }

    private function providerFile(): PhpClassFile
    {
        $api = $this->layout->ir->api->id;
        $file = new PhpClassFile($this->layout->serviceProvider);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->setExtends($file->type($this->layout->runtime('ContractServiceProvider')));
        $class->addComment("Serves api '{$api}': list it in bootstrap/providers.php, then call Route::seampact('{$api}') in the app's routes.");
        $hooks = $file->name($this->layout->runtime('Hooks'));
        $class->addConstant('DECIDERS_TAG', self::tagLiteral($hooks, $api, 'DECIDERS_TAG_SUFFIX'))->setPublic()
            ->addComment('The container tag of the deciders of this api.');
        $class->addConstant('SCOPE_RESOLVERS_TAG', self::tagLiteral($hooks, $api, 'SCOPE_RESOLVERS_TAG_SUFFIX'))->setPublic()
            ->addComment('The container tag of the scope resolvers of this api.');

        $this->contractMethod($file, 'contractClass', $this->layout->contract);
        $this->contractMethod($file, 'boundaryClass', $this->layout->boundary);
        $this->contractMethod($file, 'accessClass', $this->layout->accessMiddleware);

        $class->addMethod('publishedConfig')->setProtected()->setReturnType('string')
            ->addComment('The api\'s run-time settings with their `env()` variables, published as config/seampact/<api>.php.')
            ->setBody('return dirname(__DIR__) . ?;', ['/' . RouteTable::CONFIG_FILE]);

        $switches = $this->bootCheck?->toArray();
        $bootCheck = $class->addMethod('bootCheck')->setProtected()->setReturnType($switches === null ? 'null' : 'array')
            ->setBody('return ?;', [$switches]);
        if ($switches !== null) {
            $bootCheck->addComment('@return array{hooks: bool, handlers: bool, frameworkRoutes: bool}');
        }

        return $file;
    }

    /** The tag as an expression over the runtime's `Hooks` constants, so the strings live in the runtime alone. */
    private static function tagLiteral(string $hooksName, string $api, string $suffixConstant): Literal
    {
        return new Literal("{$hooksName}::TAG_PREFIX . ? . {$hooksName}::{$suffixConstant}", [$api]);
    }

    private function contractMethod(PhpClassFile $file, string $method, string $className): void
    {
        LaravelReplies::classOf($file)->addMethod($method)->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($className) . '::class;');
    }
}
