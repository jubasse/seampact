<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

/**
 * One `seampact.config.yaml` read through the pinned YAML parser (`symfony/yaml`), with the Node CLI's rules where
 * they differ from it (ADR 0011 "The app config"): one document, unique keys, every plain form the two read to
 * different values refused by name (`YamlScalarForm`: tags, merge keys, unquoted dates, number spellings), the names
 * that reach a JavaScript object's prototype refused, and an alias that expands past a budget refused, so a config
 * one runner reads the other reads the same or refuses by name.
 */
final class ConfigYaml
{
    // The config is trusted (A46), but a stray huge file is refused before it is parsed.
    public const MAX_CONFIG_BYTES = 1024 * 1024;

    private const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

    private const BYTE_ORDER_MARK = "\u{FEFF}";

    private const PARSE_FLAGS = Yaml::PARSE_OBJECT_FOR_MAP | Yaml::PARSE_DATETIME | Yaml::PARSE_EXCEPTION_ON_INVALID_TYPE;

    // Aliases share their anchored value; past this many values once expanded the file is an alias bomb.
    private const EXPANDED_VALUES_MAX = 100_000;

    private const SYNTAX_FIX = 'Correct the YAML at that position.';

    private int $expandedValues = 0;

    /** @var list<ConfigProblem> */
    private array $problems = [];

    private function __construct(private readonly string $displayName)
    {
    }

    /** @return ConfigTree|list<ConfigProblem> the file's tree, or the problems refusing it */
    public static function readFile(string $file, string $displayName, ConfigKind $kind): ConfigTree|array
    {
        if (!is_file($file)) {
            $fix = $kind === ConfigKind::App
                ? 'Create `seampact.config.yaml` in the app\'s directory, or pass its path with `--config`.'
                : 'Pass the path of the monorepo root\'s `seampact.config.yaml`, the one holding `apps`.';

            return [new ConfigProblem('config.file.missing', "No {$kind->value} at {$displayName}.", $fix)];
        }

        $size = filesize($file);
        if ($size !== false && $size > self::MAX_CONFIG_BYTES) {
            return [new ConfigProblem(
                'config.file.too-large',
                "{$displayName} holds {$size} bytes, over the " . self::MAX_CONFIG_BYTES . " bytes {$kind->articled()} may hold.",
                "Pass the path of the {$kind->value} itself.",
            )];
        }

        $text = file_get_contents($file);
        if ($text === false) {
            return [new ConfigProblem('config.file.unreadable', "{$displayName} cannot be read.", 'Check that the file is readable by this user.')];
        }

        return self::parseText($text, $displayName);
    }

    /** @return ConfigTree|list<ConfigProblem> `$text` as a config tree, or the problems refusing it */
    public static function parseText(string $text, string $displayName): ConfigTree|array
    {
        if (str_starts_with($text, self::BYTE_ORDER_MARK)) {
            $text = substr($text, strlen(self::BYTE_ORDER_MARK));
        }

        $formProblems = self::formProblems($text, $displayName);
        if ($formProblems !== []) {
            return $formProblems;
        }

        $reader = new self($displayName);

        try {
            $parsed = Yaml::parse($text, self::PARSE_FLAGS);
        } catch (ParseException $error) {
            $line = $error->getParsedLine();
            $at = $line > 0 ? ":{$line}" : '';

            return [new ConfigProblem('config.yaml.syntax', self::sentence((string) preg_replace('/ at line \d+.*$/s', '', $error->getMessage())), self::SYNTAX_FIX, $displayName . $at)];
        }

        try {
            $value = $reader->converted($parsed, []);
        } catch (\OverflowException) {
            return [$reader->syntaxProblem('Excessive alias count indicates a resource exhaustion attack.', [])];
        }

        return $reader->problems === [] ? new ConfigTree($value, $displayName) : $reader->problems;
    }

    /** @return list<ConfigProblem> */
    private static function formProblems(string $text, string $displayName): array
    {
        $problems = [];

        foreach (YamlTokens::of($text) as $token) {
            $form = YamlScalarForm::of($token);
            if ($form !== null) {
                $problems[] = new ConfigProblem($form->code(), $form->message($token->text), $form->fix(), "{$displayName}:{$token->line}");
            }
        }

        return $problems;
    }

    /**
     * A fresh copy of the parsed value, so no two keys share one object through an alias.
     *
     * @param list<string|int> $path
     */
    private function converted(mixed $value, array $path): mixed
    {
        if (++$this->expandedValues > self::EXPANDED_VALUES_MAX) {
            throw new \OverflowException('alias budget');
        }

        if ($value instanceof \DateTimeInterface) {
            $this->problems[] = new ConfigProblem(
                'config.yaml.date',
                'An unquoted date is read as a timestamp by this YAML parser and as text by the YAML 1.2 core schema.',
                'Quote the value, such as \'2026-10-26\'.',
                $this->whereOf($path),
            );

            return null;
        }

        if ($value instanceof \stdClass) {
            return $this->mapping($value, $path);
        }

        if (is_array($value)) {
            $items = [];
            foreach (array_values($value) as $index => $item) {
                $items[] = $this->converted($item, [...$path, $index]);
            }

            return $items;
        }

        return $value;
    }

    /** @param list<string|int> $path */
    private function mapping(\stdClass $value, array $path): \stdClass
    {
        $members = new \stdClass();

        foreach (get_object_vars($value) as $key => $member) {
            $key = (string) $key;

            if (in_array($key, self::RESERVED_KEYS, true)) {
                $this->problems[] = new ConfigProblem(
                    'config.key.reserved',
                    "The key '{$key}' is reserved: it would reach a JavaScript object's prototype.",
                    'Rename or remove the key.',
                    $this->whereOf([...$path, $key]),
                );
                continue;
            }

            $members->{$key} = $this->converted($member, [...$path, $key]);
        }

        return $members;
    }

    /** @param list<string|int> $path */
    private function syntaxProblem(string $message, array $path): ConfigProblem
    {
        return new ConfigProblem('config.yaml.syntax', $message, self::SYNTAX_FIX, $this->whereOf($path));
    }

    /** @param list<string|int> $path */
    private function whereOf(array $path): string
    {
        return (new ConfigTree(null, $this->displayName))->whereOf($path);
    }

    private static function sentence(string $text): string
    {
        $firstLine = trim(explode("\n", $text)[0]);
        $capitalized = ucfirst($firstLine);

        return str_ends_with($capitalized, '.') ? $capitalized : "{$capitalized}.";
    }
}
