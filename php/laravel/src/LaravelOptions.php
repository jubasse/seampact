<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\FrameworkEtagMode;
use Seampact\Codegen\OptionValues;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\ResponsesMode;
use Seampact\Codegen\RulesMode;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * The validated options of a laravel target entry (ADR 0023 "Options and registration"): the shared options of every
 * PHP target, and `routes`. `responses`, `bodyValidation`, `frameworkEtag` and `catchAll` are the run-time defaults
 * the generated route table carries.
 */
final readonly class LaravelOptions
{
    public const DEFAULT_INDENT_SPACES = TargetOptions::DEFAULT_INDENT_SPACES;

    private const ROUTES = 'routes';

    public function __construct(
        public string $namespace,
        public int $indentSpaces,
        public RoutesForm $routes,
        public RulesMode $rules,
        public ResponsesMode $responses,
        public bool $bodyValidation,
        public FrameworkEtagMode $frameworkEtag,
        public bool $catchAll,
    ) {
    }

    /** @throws GenerationRefusedException an unknown key, or a value outside its set */
    public static function parse(\stdClass $raw, string $psr4Namespace, string $entryId): self
    {
        $refusals = new Refusals($entryId, LaravelGenerator::TARGET, LaravelGenerator::PACKAGE);
        $values = new OptionValues($raw, LaravelGenerator::TARGET, [...TargetOptions::KEYS, self::ROUTES], $refusals);
        $shared = TargetOptions::read($values, $psr4Namespace);
        $routes = $values->choice(self::ROUTES, RoutesForm::Macro);
        $refusals->throwIfAny();

        if ($shared === null || $routes === null) {
            throw new \LogicException('An option without a value was not refused.');
        }

        return new self($shared->namespace, $shared->indentSpaces, $routes, $shared->rules, $shared->responses, $shared->bodyValidation, $shared->frameworkEtag, $shared->catchAll);
    }
}
