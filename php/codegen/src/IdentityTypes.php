<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\CredentialIdentity;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\Property;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\SchemaPrincipal;
use Seampact\Ir\Model\SignedIdentity;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;

/**
 * The types of each identity a kept operation reads (ADR 0012 "Hooks"): the authenticate hook interface the app
 * registers as the target says, the credentials class its hook receives, one nullable string per scheme, redacted
 * when dumped, and the principal class its hook returns with the interface of its member accessors.
 */
final class IdentityTypes
{
    private const AUTHENTICATE_HOOK = 'Seampact\\Hooks\\AuthenticateHook';
    private const REDACTED = '[redacted]';

    /** @param string $registration how the app registers a hook, a sentence ending the hook interface's comment */
    public function __construct(
        private readonly BoundaryNames $names,
        private readonly ContractClass $contract,
        private readonly Refusals $refusals,
        private readonly string $registration,
    ) {
    }

    /**
     * Claims the hook interface, credentials class, principal class and principal members interface of each identity a
     * kept operation reads, under `$namespace`.
     *
     * @return array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> by identity, sorted
     */
    public static function claimed(ApiLayout $layout, KeptForms $kept, string $namespace): array
    {
        $identities = [];
        foreach ($kept->operations() as [$index, $operation]) {
            $identity = $operation->access instanceof IdentityAccess || $operation->access instanceof OptionalAccess ? $operation->access->identity : null;
            if ($identity === null || isset($identities[$identity])) {
                continue;
            }

            $at = IrPlace::ofOperation($index, $operation->id)->below('access', 'identity');
            $segments = SplitName::segmentsOf($identity, NameSource::Name) ?? [$identity];
            $identities[$identity] = [
                'hook' => $layout->claim($namespace . '\\' . PhpNames::identifier([...$segments, 'authenticate', 'hook'], NamingRole::Schema), "the authenticate hook of identity '{$identity}'", $at),
                'credentials' => $layout->claim($namespace . '\\' . PhpNames::identifier([...$segments, 'credentials'], NamingRole::Schema), "the credentials of identity '{$identity}'", $at),
                'principal' => $layout->claim($namespace . '\\' . PhpNames::identifier([...$segments, 'principal'], NamingRole::Schema), "the principal of identity '{$identity}'", $at),
                'principalMembers' => $layout->claim($namespace . '\\' . PhpNames::identifier([...$segments, 'principal', 'members'], NamingRole::Schema), "the principal members interface of identity '{$identity}'", $at),
            ];
        }
        ksort($identities);

        return $identities;
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        $files = [];
        foreach ($this->names->identities() as $identity => $classes) {
            $files[] = $this->hookFile($identity, $classes['hook']);
            $files[] = $this->credentialsFile($identity, $classes['credentials']);
            array_push($files, ...$this->principalFiles($identity, $classes['principal'], $classes['principalMembers']));
        }

        return $files;
    }

    /**
     * The principal's members, by wire name, each with its accessor: the only part of a principal the boundary reads
     * (the idempotency partition, a bucket key), so every principal an app returns is read the same way.
     *
     * @return array<string, string>
     */
    public static function principalAccessors(ApiLayout $layout, string $identity): array
    {
        $accessors = [];
        foreach (self::principalProperties($layout, $identity) as [$property]) {
            $accessor = PhpNames::memberIdentifier($property->name, $property->codeName);
            if ($accessor !== null) {
                $accessors[$property->name] = $accessor;
            }
        }

        return $accessors;
    }

    /**
     * The interface with one accessor per principal member, and the generated principal class implementing it.
     *
     * @return list<PhpClassFile>
     */
    private function principalFiles(string $identity, string $className, string $interfaceName): array
    {
        $types = new PhpTypes($this->names->layout());
        $interfaceFile = new PhpClassFile($interfaceName);
        $interface = $interfaceFile->namespace->addInterface($interfaceFile->shortName);
        $interface->addComment("The principal members of identity '{$identity}' the boundary reads; its authenticate hook returns an object implementing it.");

        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly()->addImplement($interfaceName);
        $class->addComment("The principal of identity '{$identity}', as the contract declares it.");
        $constructor = $class->addMethod('__construct');

        $properties = self::principalProperties($this->names->layout(), $identity);
        if ($properties === []) {
            // Without a member every caller of the identity would share one idempotency partition and bucket.
            $this->refusals->add(
                'principal.members.none',
                "The principal of identity '{$identity}' is not an object schema with at least one member, so the boundary cannot tell its callers apart.",
                'Declare the principal as an object schema with the members that identify a caller (an id).',
                IrPlace::root()->below('identities', $identity, 'principal'),
            );
        }

        foreach ($properties as [$property, $at]) {
            $member = PhpNames::memberIdentifier($property->name, $property->codeName);
            if ($member === null) {
                $this->refusals->inconsistent('property.no-segment', "The property '{$property->name}' yields no name segment", $at);
                continue;
            }
            if (!$property->type instanceof ScalarTypeUse) {
                $this->refusals->waiting('principal.member.type', "The principal member '{$property->name}' of identity '{$identity}', which is not a scalar,", $at->below('type'), Delivery::Consumer);
                continue;
            }

            $memberType = $types->ofProperty($property, $file);
            PhpTypes::promote($constructor, $member, $memberType);
            $interface->addMethod($member)->setPublic()->setReturnType($memberType->native)->setReturnNullable($memberType->nullable);
            $class->addMethod($member)->setPublic()->setReturnType($memberType->native)->setReturnNullable($memberType->nullable)
                ->setBody("return \$this->{$member};");
        }

        return [$interfaceFile, $file];
    }

    /** @return list<array{Property, IrPlace}> the properties of the identity's principal schema */
    private static function principalProperties(ApiLayout $layout, string $identity): array
    {
        $declared = $layout->ir->identities[$identity] ?? null;
        $principal = $declared instanceof CredentialIdentity || $declared instanceof SignedIdentity ? $declared->principal : null;
        $schemaId = $principal instanceof SchemaPrincipal ? $principal->schema : null;
        $schema = $schemaId === null ? null : $layout->ir->schemas[$schemaId] ?? null;
        if (!$schema instanceof ObjectSchema) {
            return [];
        }

        $properties = [];
        foreach ($schema->properties as $index => $property) {
            $properties[] = [$property, IrPlace::root()->below('schemas', (string) $schemaId, 'properties', $index)];
        }

        return $properties;
    }

    /**
     * The credentials property of each scheme, by scheme id.
     *
     * @param list<string> $schemes
     * @return array<string, ?string>
     */
    public static function schemeMembers(array $schemes): array
    {
        $members = [];
        foreach ($schemes as $scheme) {
            $members[$scheme] = PhpNames::memberIdentifier($scheme);
        }

        return $members;
    }

    private function hookFile(string $identity, string $className): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $interface = $file->namespace->addInterface($file->shortName)->addExtend($file->type(self::AUTHENTICATE_HOOK));
        $call = $file->name($this->names->runtime('AuthenticateCall'));
        $hook = $file->name(self::AUTHENTICATE_HOOK);
        $interface->addComment("Authenticates the requests of identity '{$identity}'; {$this->registration}.\n\n@extends {$hook}<{$call}>");

        return $file;
    }

    private function credentialsFile(string $identity, string $className): PhpClassFile
    {
        $file = new PhpClassFile($className);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addComment("The credentials a request presents for identity '{$identity}', one per scheme, null when absent.");
        $constructor = $class->addMethod('__construct');
        $lines = [];
        foreach (self::schemeMembers($this->contract->schemesOf($identity)) as $scheme => $member) {
            if ($member === null) {
                $this->refusals->inconsistent('scheme.no-segment', "The scheme '{$scheme}' yields no name segment", IrPlace::root()->below('schemes', $scheme));
                continue;
            }
            $constructor->addPromotedParameter($member)->setType('?string');
            $lines[] = "\t" . var_export($member, true) . " => \$this->{$member} === null ? null : self::REDACTED,";
        }

        $class->addConstant('REDACTED', self::REDACTED)->setPrivate();
        $class->addMethod('__debugInfo')->setReturnType('array')
            ->addComment('@return array<string, ?string> each credential redacted, so a dump never shows it')
            ->setBody($lines === [] ? 'return [];' : "return [\n" . implode("\n", $lines) . "\n];");

        return $file;
    }
}
