<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Read\NestingCheck;

/**
 * A bundle's JSON comes from the network: refused when it is not UTF-8, starts with a byte order mark, nests past
 * the reader's bound or is not JSON, then when any key is a name that reaches a JavaScript prototype (every reader
 * refuses the same manifest), before a schema or a reader sees it. Objects decode as `stdClass`.
 */
final readonly class UntrustedJson
{
    private const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

    private const BYTE_ORDER_MARK = "\u{FEFF}";

    // The nesting scan bounds the depth first; the parser is given room, not a bound.
    private const PARSER_DEPTH = 512;

    /** @param ?string $problem why the text is refused, as the end of a sentence naming the file */
    private function __construct(public mixed $document, public ?string $problem)
    {
    }

    public static function parse(string $bytes): self
    {
        if (!BundleText::isUtf8($bytes)) {
            return self::refused('is not UTF-8 text');
        }

        if (str_starts_with($bytes, self::BYTE_ORDER_MARK)) {
            return self::refused('starts with a byte order mark (U+FEFF)');
        }

        $nesting = NestingCheck::checkText($bytes);
        if ($nesting !== null) {
            return self::refused('is not readable: ' . $nesting->message);
        }

        try {
            $document = json_decode($bytes, false, self::PARSER_DEPTH, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            return self::refused('is not JSON (' . BundleText::quoted($error->getMessage()) . ')');
        }

        $reservedAt = self::reservedKeyPointer($document);
        if ($reservedAt !== null) {
            return self::refused('holds the reserved key at ' . BundleText::quoted($reservedAt));
        }

        return new self($document, null);
    }

    /**
     * The JSON Pointer of the first key given twice in one object of `$text`, which the parser already accepted;
     * null when every key is given once (the parser keeps the last one, so two readers would read two documents).
     */
    public static function duplicateKeyPointer(string $text): ?string
    {
        /** @var list<array{pointer: string, keys: ?array<string, true>, key: string, index: int}> $stack */
        $stack = [];
        $expectingKey = false;
        $length = strlen($text);

        for ($at = 0; $at < $length; $at++) {
            $top = array_key_last($stack);
            $character = $text[$at];

            if ($character === '"') {
                $end = self::stringEnd($text, $at);
                if ($expectingKey && $top !== null && $stack[$top]['keys'] !== null) {
                    $key = json_decode(substr($text, $at, $end - $at + 1), false, 1, JSON_THROW_ON_ERROR);
                    $key = is_string($key) ? $key : '';
                    if (isset($stack[$top]['keys'][$key])) {
                        return BundleText::pointerBelow($stack[$top]['pointer'], $key);
                    }
                    $stack[$top]['keys'][$key] = true;
                    $stack[$top]['key'] = $key;
                    $expectingKey = false;
                }
                $at = $end;
                continue;
            }

            if ($character === '{' || $character === '[') {
                $pointer = $top === null ? '' : self::childPointer($stack[$top]);
                $isObject = $character === '{';
                $stack[] = ['pointer' => $pointer, 'keys' => $isObject ? [] : null, 'key' => '', 'index' => 0];
                $expectingKey = $isObject;
                continue;
            }

            if ($character === '}' || $character === ']') {
                array_pop($stack);
                continue;
            }

            if ($character === ',' && $top !== null) {
                $stack[$top]['index']++;
                $expectingKey = $stack[$top]['keys'] !== null;
            }
        }

        return null;
    }

    private static function refused(string $problem): self
    {
        return new self(null, $problem);
    }

    /** @param array{pointer: string, keys: ?array<string, true>, key: string, index: int} $frame */
    private static function childPointer(array $frame): string
    {
        return BundleText::pointerBelow($frame['pointer'], $frame['keys'] === null ? (string) $frame['index'] : $frame['key']);
    }

    // The index of the quote that closes the string opened at `$start`.
    private static function stringEnd(string $text, int $start): int
    {
        $length = strlen($text);
        for ($at = $start + 1; $at < $length; $at++) {
            if ($text[$at] === '\\') {
                $at++;
            } elseif ($text[$at] === '"') {
                return $at;
            }
        }

        throw new \LogicException('bundle: a JSON string the parser accepted has no closing quote.');
    }

    // Iterative: the nesting bound holds, but a wide document is walked without recursion all the same.
    private static function reservedKeyPointer(mixed $root): ?string
    {
        /** @var list<array{mixed, string}> $pending */
        $pending = [[$root, '']];

        while ($pending !== []) {
            [$value, $pointer] = array_pop($pending);

            if ($value instanceof \stdClass) {
                foreach (get_object_vars($value) as $key => $member) {
                    $at = BundleText::pointerBelow($pointer, (string) $key);
                    if (in_array((string) $key, self::RESERVED_KEYS, true)) {
                        return $at;
                    }
                    $pending[] = [$member, $at];
                }
            } elseif (is_array($value)) {
                foreach ($value as $index => $member) {
                    $pending[] = [$member, BundleText::pointerBelow($pointer, (string) $index)];
                }
            }
        }

        return null;
    }
}
