<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\HandlerWarningGenerator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Symfony\SymfonyGenerator;

/**
 * The api-platform target (ADR 0029), which `vendor/bin/seampact` finds through `extra.seampact.generator`: the Symfony
 * target's whole tree for the api, with its boundary reading the operation marker from the route, and beside it the
 * API Platform resources and the processors that hand each operation's input to the developer's handler.
 */
final class ApiPlatformGenerator implements Generator, HandlerWarningGenerator
{
    public const TARGET = ApiPlatformFlavour::TARGET;
    public const PACKAGE = ApiPlatformFlavour::PACKAGE;

    private readonly SymfonyGenerator $symfony;

    public function __construct()
    {
        $this->symfony = new SymfonyGenerator(new ApiPlatformFlavour());
    }

    public function irSupport(): IrSupport
    {
        return $this->symfony->irSupport();
    }

    public function handlerWarnings(ContractIR $ir, TargetEntry $entry): array
    {
        return $this->symfony->handlerWarnings($ir, $entry);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        return $this->symfony->generate($ir, $entry);
    }
}
