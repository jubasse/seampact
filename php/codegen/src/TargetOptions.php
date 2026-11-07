<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The options every PHP framework target takes (ADR 0023 and 0024 "Options and registration"). The generated
 * namespace is not an option: it is the PSR-4 namespace `composer.json` gives the entry's output directory, where
 * Composer loads the classes from. `layout`, `handlers: perOperation` and the naming options of ADR 0007 are refused
 * by name: a PHP target writes one file per class under its PSR-4 directory and groups operations per resource.
 */
final readonly class TargetOptions
{
    public const DEFAULT_INDENT_SPACES = 4;
    private const MAX_INDENT_SPACES = 8;

    private const INDENT = 'indent';
    private const LAYOUT = 'layout';
    private const RULES = 'rules';
    private const RESPONSES = 'responses';
    private const BODY_VALIDATION = 'bodyValidation';
    private const FRAMEWORK_ETAG = 'frameworkEtag';
    private const CATCH_ALL = 'catchAll';
    private const HANDLERS = 'handlers';
    private const PER_RESOURCE = 'perResource';
    private const NAMING_KEYS = ['suffixes', 'escape', 'enumCase'];

    /** Every key these options read, the ones refused by name included. */
    public const KEYS = [
        self::INDENT, self::LAYOUT, self::RULES, self::RESPONSES, self::BODY_VALIDATION,
        self::FRAMEWORK_ETAG, self::CATCH_ALL, self::HANDLERS, ...self::NAMING_KEYS,
    ];

    public function __construct(
        public string $namespace,
        public int $indentSpaces,
        public RulesMode $rules,
        public ResponsesMode $responses,
        public bool $bodyValidation,
        public FrameworkEtagMode $frameworkEtag,
        public bool $catchAll,
    ) {
    }

    /** The shared options, or null when one of them was refused into the values' refusals. */
    public static function read(OptionValues $values, string $psr4Namespace): ?self
    {
        $indent = self::indentOf($values);
        $rules = $values->choice(self::RULES, RulesMode::Native);
        $responses = $values->choice(self::RESPONSES, ResponsesMode::Strict);
        $etag = $values->choice(self::FRAMEWORK_ETAG, FrameworkEtagMode::Strip);
        $bodyValidation = $values->flag(self::BODY_VALIDATION, false);
        $catchAll = $values->flag(self::CATCH_ALL, true);
        $target = $values->target();

        if ($values->has(self::LAYOUT)) {
            $values->refuse('options.layout.unsupported', self::LAYOUT, "The option 'layout' is set; the {$target} target writes one file per class under its PSR-4 directory, the only layout Composer loads, and takes no other.", "Remove 'layout' from the target's `options`.");
        }

        if ($values->has(self::HANDLERS) && $values->value(self::HANDLERS) !== self::PER_RESOURCE) {
            $values->refuse('options.handlers.unsupported', self::HANDLERS, "The option 'handlers' is " . OptionValues::shown($values->value(self::HANDLERS)) . "; the {$target} target groups operations per resource only (ADR 0007 'perResource'), and 'perOperation' waits for an app that needs it.", "Set 'handlers' to 'perResource', or leave it out.");
        }

        foreach (self::NAMING_KEYS as $key) {
            if ($values->has($key)) {
                $values->refuse('options.naming.unsupported', $key, "The naming option '{$key}' is not taken by the {$target} target yet: it names PHP with the defaults of ADR 0007, which the shared naming vectors test.", "Remove '{$key}' from the target's `options`.");
            }
        }

        if ($indent === null || $rules === null || $responses === null || $etag === null || $bodyValidation === null || $catchAll === null) {
            return null;
        }

        return new self($psr4Namespace, $indent, $rules, $responses, $bodyValidation, $etag, $catchAll);
    }

    private static function indentOf(OptionValues $values): ?int
    {
        $value = $values->value(self::INDENT);
        if ($value === null) {
            return self::DEFAULT_INDENT_SPACES;
        }

        if (is_int($value) && $value >= 1 && $value <= self::MAX_INDENT_SPACES) {
            return $value;
        }

        $values->refuse('options.indent.invalid', self::INDENT, "The option 'indent' is " . OptionValues::shown($value) . ', not a number of spaces from 1 to ' . self::MAX_INDENT_SPACES . '.', "Set 'indent' to a whole number of spaces, or leave it out for " . self::DEFAULT_INDENT_SPACES . '.');

        return null;
    }
}
