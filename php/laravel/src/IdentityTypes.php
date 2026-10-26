<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpNames;
use Seampact\Codegen\Refusals;

/**
 * The types of each identity a kept operation reads (ADR 0012 "Hooks"): the authenticate hook interface the app binds
 * in the container, and the credentials class its hook receives, one nullable string per scheme, redacted when dumped.
 */
final class IdentityTypes
{
    private const AUTHENTICATE_HOOK = 'Seampact\\Hooks\\AuthenticateHook';
    private const REDACTED = '[redacted]';

    public function __construct(private readonly PhpLayout $layout, private readonly ContractClass $contract, private readonly Refusals $refusals)
    {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        $files = [];
        foreach ($this->layout->identities() as $identity => $classes) {
            $files[] = $this->hookFile($identity, $classes['hook']);
            $files[] = $this->credentialsFile($identity, $classes['credentials']);
        }

        return $files;
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
        $call = $file->name($this->layout->runtime('AuthenticateCall'));
        $hook = $file->name(self::AUTHENTICATE_HOOK);
        $interface->addComment("Authenticates the requests of identity '{$identity}'; bind it in the container.\n\n@extends {$hook}<{$call}>");

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
