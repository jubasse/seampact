<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\IrPlace;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * The validated options of a laravel target entry (ADR 0023 "Options and registration"), every unknown key refused
 * by name. `namespace` is required and must be the PSR-4 namespace of the entry's output directory, where Composer
 * loads the classes from. `responses`, `bodyValidation`, `frameworkEtag` and `catchAll` are the run-time defaults
 * the generated route table carries.
 */
final readonly class LaravelOptions
{
    public const DEFAULT_INDENT_SPACES = 4;
    private const MAX_INDENT_SPACES = 8;

    private const NAMESPACE = 'namespace';
    private const INDENT = 'indent';
    private const LAYOUT = 'layout';
    private const ROUTES = 'routes';
    private const RULES = 'rules';
    private const RESPONSES = 'responses';
    private const BODY_VALIDATION = 'bodyValidation';
    private const FRAMEWORK_ETAG = 'frameworkEtag';
    private const CATCH_ALL = 'catchAll';
    private const HANDLERS = 'handlers';
    private const PER_RESOURCE = 'perResource';
    private const NAMING_KEYS = ['suffixes', 'escape', 'enumCase'];
    private const KNOWN_KEYS = [
        self::NAMESPACE, self::INDENT, self::LAYOUT, self::ROUTES, self::RULES, self::RESPONSES, self::BODY_VALIDATION,
        self::FRAMEWORK_ETAG, self::CATCH_ALL, self::HANDLERS, ...self::NAMING_KEYS,
    ];
    private const NAMESPACE_PATTERN = '/^[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*(\\\\[A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)*$/D';

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

    /** @throws GenerationRefusedException an unknown key, a missing or wrong `namespace`, or a value outside its set */
    public static function parse(\stdClass $raw, string $psr4Namespace, string $entryId): self
    {
        $refusals = new Refusals($entryId, LaravelGenerator::TARGET, LaravelGenerator::PACKAGE);
        // A numeric option name decodes to an integer key; it is still a name.
        $values = [];
        foreach (get_object_vars($raw) as $key => $value) {
            $values[(string) $key] = $value;
        }

        foreach (array_keys($values) as $key) {
            if (!in_array($key, self::KNOWN_KEYS, true)) {
                self::refuse($refusals, 'options.unknown', (string) $key, "The option '{$key}' is not one the laravel target knows; it takes '" . implode("', '", self::KNOWN_KEYS) . "'.", "Remove '{$key}' from the target's `options`.");
            }
        }

        $namespace = self::namespaceOf($values[self::NAMESPACE] ?? null, $psr4Namespace, $refusals);
        $indent = self::indentOf($values[self::INDENT] ?? null, $refusals);
        $routes = self::choice($values, self::ROUTES, RoutesForm::Macro, RoutesForm::tryFrom(...), array_column(RoutesForm::cases(), 'value'), $refusals);
        $rules = self::choice($values, self::RULES, RulesMode::Native, RulesMode::tryFrom(...), array_column(RulesMode::cases(), 'value'), $refusals);
        $responses = self::choice($values, self::RESPONSES, ResponsesMode::Strict, ResponsesMode::tryFrom(...), array_column(ResponsesMode::cases(), 'value'), $refusals);
        $etag = self::choice($values, self::FRAMEWORK_ETAG, FrameworkEtagMode::Strip, FrameworkEtagMode::tryFrom(...), array_column(FrameworkEtagMode::cases(), 'value'), $refusals);
        $bodyValidation = self::flag($values, self::BODY_VALIDATION, false, $refusals);
        $catchAll = self::flag($values, self::CATCH_ALL, true, $refusals);

        if (array_key_exists(self::LAYOUT, $values)) {
            self::refuse($refusals, 'options.layout.unsupported', self::LAYOUT, 'The option \'layout\' is set; the laravel target writes one file per class under its PSR-4 directory, the only layout Composer loads, and takes no other.', "Remove 'layout' from the target's `options`.");
        }

        if (array_key_exists(self::HANDLERS, $values) && $values[self::HANDLERS] !== self::PER_RESOURCE) {
            self::refuse($refusals, 'options.handlers.unsupported', self::HANDLERS, "The option 'handlers' is " . self::shown($values[self::HANDLERS]) . "; the laravel target groups operations per resource only (ADR 0007 'perResource'), and 'perOperation' waits for an app that needs it.", "Set 'handlers' to 'perResource', or leave it out.");
        }

        foreach (self::NAMING_KEYS as $key) {
            if (array_key_exists($key, $values)) {
                self::refuse($refusals, 'options.naming.unsupported', $key, "The naming option '{$key}' is not taken by the laravel target yet: it names PHP with the defaults of ADR 0007, which the shared naming vectors test.", "Remove '{$key}' from the target's `options`.");
            }
        }

        $refusals->throwIfAny();

        if ($namespace === null || $indent === null || $routes === null || $rules === null || $responses === null || $etag === null || $bodyValidation === null || $catchAll === null) {
            throw new \LogicException('An option without a value was not refused.');
        }

        return new self($namespace, $indent, $routes, $rules, $responses, $bodyValidation, $etag, $catchAll);
    }

    private static function namespaceOf(mixed $value, string $psr4Namespace, Refusals $refusals): ?string
    {
        if ($value === null) {
            self::refuse($refusals, 'options.namespace.missing', self::NAMESPACE, "The option 'namespace' is missing; the laravel target has no default namespace.", "Set 'namespace' to the PSR-4 namespace of the entry's output directory" . ($psr4Namespace === '' ? '' : ", '{$psr4Namespace}'") . '.');

            return null;
        }

        if (!is_string($value) || preg_match(self::NAMESPACE_PATTERN, $value) !== 1) {
            self::refuse($refusals, 'options.namespace.invalid', self::NAMESPACE, "The option 'namespace' is " . self::shown($value) . ', not a PHP namespace.', "Set 'namespace' to backslash-separated PHP names, such as 'App\\Contracts\\Tasks'.");

            return null;
        }

        if ($value !== $psr4Namespace) {
            self::refuse($refusals, 'options.namespace.mismatch', self::NAMESPACE, "The option 'namespace' is '{$value}', but composer.json maps the entry's output directory to '{$psr4Namespace}', so Composer would not load the generated classes.", "Set 'namespace' to '{$psr4Namespace}', or change the entry's `out` or the PSR-4 entry of composer.json.");

            return null;
        }

        return $value;
    }

    private static function indentOf(mixed $value, Refusals $refusals): ?int
    {
        if ($value === null) {
            return self::DEFAULT_INDENT_SPACES;
        }

        if (is_int($value) && $value >= 1 && $value <= self::MAX_INDENT_SPACES) {
            return $value;
        }

        self::refuse($refusals, 'options.indent.invalid', self::INDENT, "The option 'indent' is " . self::shown($value) . ', not a number of spaces from 1 to ' . self::MAX_INDENT_SPACES . '.', "Set 'indent' to a whole number of spaces, or leave it out for " . self::DEFAULT_INDENT_SPACES . '.');

        return null;
    }

    /**
     * @template T of \BackedEnum
     * @param array<string, mixed> $values
     * @param T $default
     * @param callable(string): (T|null) $fromValue
     * @param list<string> $allowed
     * @return T|null
     */
    private static function choice(array $values, string $key, \BackedEnum $default, callable $fromValue, array $allowed, Refusals $refusals): ?\BackedEnum
    {
        if (!array_key_exists($key, $values)) {
            return $default;
        }

        $chosen = is_string($values[$key]) ? $fromValue($values[$key]) : null;
        if ($chosen !== null) {
            return $chosen;
        }

        self::refuse($refusals, "options.{$key}.invalid", $key, "The option '{$key}' is " . self::shown($values[$key]) . ", not one of '" . implode("', '", $allowed) . "'.", "Set '{$key}' to '{$default->value}' (the default) or another listed value.");

        return null;
    }

    /** @param array<string, mixed> $values */
    private static function flag(array $values, string $key, bool $default, Refusals $refusals): ?bool
    {
        if (!array_key_exists($key, $values)) {
            return $default;
        }

        if (is_bool($values[$key])) {
            return $values[$key];
        }

        self::refuse($refusals, "options.{$key}.invalid", $key, "The option '{$key}' is " . self::shown($values[$key]) . ', not true or false.', "Set '{$key}' to true or false (the default is " . ($default ? 'true' : 'false') . ').');

        return null;
    }

    private static function refuse(Refusals $refusals, string $code, string $key, string $message, string $fix): void
    {
        $refusals->add($code, $message, $fix, IrPlace::root()->below('options', $key));
    }

    private static function shown(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) ?: get_debug_type($value);
    }
}
