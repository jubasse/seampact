<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * The YAML forms this runner's parser (`symfony/yaml`, YAML 1.1 rules) reads to another value than the YAML 1.2
 * core schema of the Node CLI and the JVM plugins, each refused by name as `config.yaml.<form>`. A form both read
 * alike, such as `1:30` (text on both), is read. Each form is checked on plain scalars and keys only, so a quoted
 * value or a comment holding it is text.
 */
enum YamlScalarForm: string
{
    case MergeKey = 'merge-key';
    case Date = 'date';
    case LeadingZero = 'leading-zero';
    case UnderscoreNumber = 'underscore-number';
    case SignedNumber = 'signed-number';
    case KeywordCase = 'keyword-case';
    case IntegerRange = 'integer-range';
    case Tag = 'tag';

    private const MERGE_KEY = '<<';

    // The YAML 1.1 timestamp, as `symfony/yaml` reads it (a key too, as a Unix time).
    private const DATE = '/^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?$/D';

    // `symfony/yaml` keeps these as text; the core schema reads a number (`-0` is minus zero).
    private const LEADING_ZERO = '/^(?:[-+]?0[0-9]+|-0)$/D';

    // `symfony/yaml` drops the underscores and reads a number; the core schema reads text.
    private const UNDERSCORE_NUMBER = '/^(?=.*_)(?:[-+]?0o[0-7_]+|0x[0-9a-fA-F_]+|[-+]?[0-9][0-9_]*(?:\.[0-9_]+)?)$/D';

    // A signed octal number is a number for `symfony/yaml` and text for the core schema; `+.inf` the other way.
    private const SIGNED_NUMBER = '/^(?:[-+]0o[0-7]+|\+\.(?:inf|Inf|INF))$/D';

    // `symfony/yaml` reads these keywords in any case; the core schema only in these spellings.
    private const CORE_KEYWORDS = [
        'null' => ['null', 'Null', 'NULL'],
        'true' => ['true', 'True', 'TRUE'],
        'false' => ['false', 'False', 'FALSE'],
        '.inf' => ['.inf', '.Inf', '.INF'],
        '-.inf' => ['-.inf', '-.Inf', '-.INF'],
        '.nan' => ['.nan', '.NaN', '.NAN'],
    ];

    private const DECIMAL_INTEGER = '/^[-+]?([1-9][0-9]*)$/D';

    // The largest integer a JavaScript number holds exactly (2^53 - 1); past it Node rounds and PHP does not.
    private const SAFE_INTEGER_MAX = 9_007_199_254_740_991;

    private const SAFE_INTEGER_DIGITS = 16;

    public static function of(YamlToken $token): ?self
    {
        if ($token->kind === YamlTokenKind::Tag) {
            return self::Tag;
        }

        if ($token->kind === YamlTokenKind::Key && $token->text === self::MERGE_KEY) {
            return self::MergeKey;
        }

        return match (true) {
            preg_match(self::DATE, $token->text) === 1 => self::Date,
            preg_match(self::LEADING_ZERO, $token->text) === 1 => self::LeadingZero,
            preg_match(self::UNDERSCORE_NUMBER, $token->text) === 1 => self::UnderscoreNumber,
            preg_match(self::SIGNED_NUMBER, $token->text) === 1 => self::SignedNumber,
            self::isOtherKeywordCase($token->text) => self::KeywordCase,
            self::isPastSafeInteger($token->text) => self::IntegerRange,
            default => null,
        };
    }

    public function code(): string
    {
        return "config.yaml.{$this->value}";
    }

    public function message(string $text): string
    {
        return match ($this) {
            self::MergeKey => 'A merge key (`<<`) is not read; a config writes each key itself.',
            self::Date => "The unquoted date '{$text}' is read as a timestamp by this YAML parser and as text by the YAML 1.2 core schema.",
            self::LeadingZero => "'{$text}' is an integer with a leading zero or a minus zero: this YAML parser reads text, the YAML 1.2 core schema a number.",
            self::UnderscoreNumber => "'{$text}' is a number with an underscore: this YAML parser reads a number, the YAML 1.2 core schema text.",
            self::SignedNumber => "'{$text}' has a sign before an octal number or `.inf`: this YAML parser and the YAML 1.2 core schema read it differently.",
            self::KeywordCase => "'{$text}' is a null, boolean or special number in mixed case: this YAML parser reads the keyword, the YAML 1.2 core schema text.",
            self::IntegerRange => "'{$text}' is an integer past 2^53 - 1: the Node CLI rounds it, this runner keeps it.",
            self::Tag => "The tag '{$text}' is not read; a config holds plain YAML values.",
        };
    }

    public function fix(): string
    {
        return match ($this) {
            self::MergeKey => 'Write the keys of the anchored mapping in place of `<<`.',
            self::Date => 'Quote the value, such as \'2026-10-26\'.',
            self::LeadingZero => 'Quote the value to keep the text, or write the number without the leading zero.',
            self::UnderscoreNumber => 'Quote the value to keep the text, or write the number without underscores.',
            self::SignedNumber => 'Quote the value to keep the text, or write the number in decimal (`.inf` for infinity).',
            self::KeywordCase => 'Quote the value to keep the text, or write the keyword in one case, such as `null`, `true` or `false`.',
            self::IntegerRange => 'Quote the value to keep the digits as text.',
            self::Tag => 'Remove the tag, and quote the value when it must stay text.',
        };
    }

    private static function isOtherKeywordCase(string $text): bool
    {
        $spellings = self::CORE_KEYWORDS[strtolower($text)] ?? null;

        return $spellings !== null && !in_array($text, $spellings, true);
    }

    private static function isPastSafeInteger(string $text): bool
    {
        if (preg_match(self::DECIMAL_INTEGER, $text, $match) !== 1) {
            return false;
        }

        return strlen($match[1]) > self::SAFE_INTEGER_DIGITS || (int) $match[1] > self::SAFE_INTEGER_MAX;
    }
}
