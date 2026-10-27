<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Run\FrameworkRoute;

/**
 * The api's contract class the copied runtime reads (ADR 0023 "The boundary", ADR 0024 "Placement"): the IR view of the kept operations
 * and the declarations they read, the PHP class of each schema, enum, operation part, result and identity, and the
 * framework routes the boot check lets through, all as constant arrays that OPcache keeps between requests.
 */
final class ContractClass
{
    /** The IR members the runtime reads; the others stay out of the constant. */
    private const IR_MEMBERS = ['api', 'errors', 'formats', 'identities', 'schemes', 'scopes', 'rights', 'rules', 'buckets', 'pagings', 'schemas', 'enums'];

    private readonly ApiLayout $layout;

    /**
     * @param list<FrameworkRoute> $frameworkRoutes
     * @param string $mount the entry's `mount`, the prefix of every contract path; empty for none
     */
    public function __construct(
        private readonly BoundaryNames $names,
        private readonly KeptForms $kept,
        private readonly array $frameworkRoutes,
        private readonly string $mount,
        private readonly FrameworkRouteScope $frameworkRouteScope,
    )
    {
        $this->layout = $names->layout();
    }

    public function file(): PhpClassFile
    {
        $file = new PhpClassFile($this->names->contractClass());
        $class = $file->namespace->addClass($file->shortName)->setFinal();
        $class->addComment("The contract of api '{$this->layout->ir->api->id}' as its boundary reads it.");
        $class->addConstant('API', $this->layout->ir->api->id)->setPublic();
        $class->addConstant('ROUTES_CLASS', $this->names->routesClass())->setPublic();
        $class->addConstant('IR', $this->irView())->setPublic()
            ->addComment('The IR of the kept operations and the declarations the boundary reads.');
        $class->addConstant('TYPES', $this->types())->setPublic()
            ->addComment('The PHP class of each schema, enum, operation part, result and identity.');
        $class->addConstant('FRAMEWORK_ROUTES', array_map(
            static fn (FrameworkRoute $route): array => ['method' => $route->method, 'path' => $route->path],
            $this->frameworkRoutes,
        ))->setPublic()->addComment("The app routes the entry's `frameworkRoutes` lets through the boot check.");
        $class->addConstant('FRAMEWORK_ROUTE_SCOPE', $this->frameworkRouteScope->value)->setPublic()
            ->addComment("The app routes the boot check reads: `contract` those under the api's base paths, `strict` every one.");
        $class->addConstant('MOUNT', $this->mount)->setPublic()
            ->addComment("The entry's `mount`, the path prefix every contract route is served under.");

        return $file;
    }

    /** @return array<string, mixed> */
    private function irView(): array
    {
        $json = json_decode((string) json_encode($this->layout->ir->toJson(), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($json)) {
            throw new \LogicException('The IR did not encode as a JSON object.');
        }

        $view = [];
        foreach (self::IR_MEMBERS as $member) {
            $view[$member] = $json[$member] ?? [];
        }

        $operations = is_array($json['operations'] ?? null) ? $json['operations'] : [];
        $view['operations'] = [];
        foreach ($this->kept->operations() as [$index, $operation]) {
            if ($this->layout->operation($operation->id) !== null) {
                $view['operations'][] = $operations[$index];
            }
        }

        return $view;
    }

    /** @return array<string, mixed> */
    private function types(): array
    {
        $schemas = [];
        foreach ($this->kept->objects() as $schemaId => $schema) {
            $members = [];
            foreach ($schema->properties as $property) {
                $members[$property->name] = PhpNames::memberIdentifier($property->name, $property->codeName);
            }
            $schemas[$schemaId] = ['class' => $this->layout->schemaClass($schemaId), 'members' => $members];
        }

        $enums = [];
        foreach (array_keys($this->kept->enums()) as $enumId) {
            $enums[$enumId] = $this->layout->enumClass($enumId);
        }

        return [
            'schemas' => $schemas,
            'enums' => $enums,
            'operations' => $this->operationTypes(),
            'identities' => $this->identityTypes(),
        ];
    }

    /** @return array<string, array<string, mixed>> */
    private function operationTypes(): array
    {
        $types = [];
        foreach ($this->kept->operations() as [, $operation]) {
            $names = $this->layout->operation($operation->id);
            if ($names === null) {
                continue;
            }

            $parts = [];
            foreach (['path' => [$names->path, $operation->params->path], 'query' => [$names->query, $operation->params->query], 'headers' => [$names->headers, KeptForms::handlerHeaders($operation)]] as $part => [$class, $params]) {
                if ($params !== []) {
                    $parts[$part] = ['class' => $class, 'members' => self::paramMembers($params)];
                }
            }

            $types[$operation->id] = [
                'input' => $names->input,
                'parts' => $parts,
                'responses' => $names->responses,
                'errors' => $names->errors,
                ...$this->names->operationClasses($operation->id),
            ];
        }

        return $types;
    }

    /**
     * @param list<Param> $params
     * @return array<string, ?string>
     */
    private static function paramMembers(array $params): array
    {
        $members = [];
        foreach ($params as $param) {
            $members[$param->name] = PhpNames::memberIdentifier($param->name);
        }

        return $members;
    }

    /** @return array<string, array{hook: string, credentials: string, principal: string, principalMembers: string, schemes: array<string, ?string>, principalAccessors: array<string, string>}> */
    private function identityTypes(): array
    {
        $types = [];
        foreach ($this->names->identities() as $identity => $classes) {
            $types[$identity] = [
                ...$classes,
                'schemes' => IdentityTypes::schemeMembers($this->schemesOf($identity)),
                'principalAccessors' => IdentityTypes::principalAccessors($this->layout, $identity),
            ];
        }

        return $types;
    }

    /** @return list<string> the schemes the kept operations read the identity `$identity` through, sorted */
    public function schemesOf(string $identity): array
    {
        $schemes = [];
        foreach ($this->kept->operations() as [, $operation]) {
            $access = $operation->access;
            if (($access instanceof IdentityAccess || $access instanceof OptionalAccess) && $access->identity === $identity) {
                foreach ($access->schemes as $scheme) {
                    $schemes[$scheme] = true;
                }
            }
        }
        $schemes = array_map(strval(...), array_keys($schemes));
        sort($schemes);

        return $schemes;
    }
}
