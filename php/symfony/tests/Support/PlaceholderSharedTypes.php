<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Naming\Identifier;
use Seampact\Ir\Naming\IrName;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Symfony\Shared\OperationTypeNames;
use Seampact\Symfony\Shared\SharedTypes;
use Seampact\Symfony\Shared\SharedTypesSource;

/**
 * Stands in for the shared PHP emitters in the golden test until the Symfony target adopts them: every operation the
 * IR holds is kept, names follow ADR 0007 as the Laravel target writes them, and each named input, result and
 * exception is an empty placeholder file, so the golden Symfony placement compiles and PHPStan reads it.
 */
final class PlaceholderSharedTypes implements SharedTypesSource, SharedTypes
{
    private const BOUNDARY_HEADER_DERIVATION = 'identity.';

    private ContractIR $ir;
    private string $namespace;

    public function types(ContractIR $ir, string $namespace, string $entryId): SharedTypes
    {
        $types = new self();
        $types->ir = $ir;
        $types->namespace = $namespace;

        return $types;
    }

    public function operations(): array
    {
        $kept = [];
        foreach ($this->ir->operations as $index => $operation) {
            $kept[] = [$index, $operation];
        }

        return $kept;
    }

    public function handlerHeaders(Operation $operation): array
    {
        return array_values(array_filter(
            $operation->params->header,
            static fn ($param): bool => !str_starts_with($param->derivedFrom->derivation ?? '', self::BOUNDARY_HEADER_DERIVATION),
        ));
    }

    public function apiTypeName(): string
    {
        return self::identifier($this->ir->api->name->segments, NamingRole::Schema);
    }

    public function operation(string $operationId): OperationTypeNames
    {
        foreach ($this->ir->operations as $operation) {
            if ($operation->id === $operationId) {
                $segments = $operation->name->segments;
                $owner = $operation->resource !== null ? SplitName::segmentsOf($operation->resource->type, NameSource::Name) : null;

                return new OperationTypeNames(
                    self::identifier($segments, NamingRole::Operation),
                    $this->namespace . '\\' . self::identifier($segments, NamingRole::Input),
                    $this->namespace . '\\' . self::identifier([...$segments, 'result'], NamingRole::Schema),
                    $this->namespace . '\\' . self::identifier($owner ?? $this->ir->api->surfaces[$operation->surface]->name->segments, NamingRole::Endpoints),
                );
            }
        }

        throw new \LogicException("The operation '{$operationId}' is not in the IR.");
    }

    public function errorClass(string $code): ?string
    {
        $segments = SplitName::segmentsOf($code, NameSource::Name);

        return $segments === null ? null : $this->namespace . '\\' . self::identifier($segments, NamingRole::Error);
    }

    public function files(): array
    {
        $declarations = [];
        foreach ($this->ir->operations as $operation) {
            $names = $this->operation($operation->id);
            $declarations[$names->input] = 'final readonly class';
            $declarations[$names->result] = 'interface';
            foreach ($operation->errors as $error) {
                $exception = $this->errorClass($error->code);
                if ($exception !== null) {
                    $declarations[$exception] = 'final class %s extends \RuntimeException';
                }
            }
        }

        $files = [];
        foreach ($declarations as $className => $declaration) {
            $shortName = substr($className, strlen($this->namespace) + 1);
            $line = str_contains($declaration, '%s') ? sprintf($declaration, $shortName) : "{$declaration} {$shortName}";
            $files[] = new GeneratedFile(
                "{$shortName}.php",
                "<?php\n\ndeclare(strict_types=1);\n\nnamespace {$this->namespace};\n\n/** A placeholder for the shared emitters' type. */\n{$line}\n{\n}\n",
            );
        }

        return $files;
    }

    /** @param list<string> $segments */
    private static function identifier(array $segments, NamingRole $role): string
    {
        return Identifier::of(new IrName($segments, $role));
    }
}
