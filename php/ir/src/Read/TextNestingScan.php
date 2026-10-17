<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** One scan of a JSON text for the first array or object past the nesting bound, see `NestingCheck::checkText`. */
final class TextNestingScan
{
    private const UNICODE_ESCAPE_DIGITS = 4;
    private const SIMPLE_ESCAPES = ['b' => "\x08", 'f' => "\x0C", 'n' => "\n", 'r' => "\r", 't' => "\t"];
    private const REPLACEMENT_CHARACTER = 0xFFFD;

    /** @var list<OpenContainer> */
    private array $open = [];

    private int $position = 0;

    // In an object, the next string is a key after `{` or `,`, and a value after `:`.
    private bool $expectingKey = false;

    private readonly int $length;

    public function __construct(private readonly string $text)
    {
        $this->length = strlen($text);
    }

    public function firstPointerPastBound(): ?string
    {
        while ($this->position < $this->length) {
            $char = $this->text[$this->position++];
            switch ($char) {
                case '{':
                case '[':
                    if (count($this->open) === NestingCheck::MAX_NESTING_DEPTH) {
                        return $this->pointer();
                    }
                    $this->open[] = new OpenContainer($char === '{');
                    $this->expectingKey = $char === '{';
                    break;
                case '}':
                case ']':
                    array_pop($this->open);
                    $this->expectingKey = false;
                    break;
                case ',':
                    $this->nextMember();
                    break;
                case ':':
                    $this->expectingKey = false;
                    break;
                case '"':
                    $this->readString();
                    break;
            }
        }

        return null;
    }

    private function pointer(): string
    {
        $pointer = '';
        foreach ($this->open as $container) {
            $pointer .= '/' . RefusalText::escapePointerSegment($container->segment());
        }

        return $pointer;
    }

    private function nextMember(): void
    {
        $container = $this->open === [] ? null : $this->open[count($this->open) - 1];
        if ($container === null) {
            return;
        }
        if ($container->isObject) {
            $this->expectingKey = true;
        } else {
            ++$container->index;
        }
    }

    // Only a key is kept, decoded, for the pointer; any other string is skipped.
    private function readString(): void
    {
        $container = $this->open === [] ? null : $this->open[count($this->open) - 1];
        $isKey = $this->expectingKey && $container !== null && $container->isObject;
        $this->expectingKey = false;

        $key = '';
        while ($this->position < $this->length) {
            $char = $this->text[$this->position++];
            if ($char === '"') {
                break;
            }
            if ($char === '\\') {
                $key .= $this->readEscape($isKey);
            } elseif ($isKey) {
                $key .= $char;
            }
        }
        if ($container !== null && $isKey) {
            $container->key = $key;
        }
    }

    // The decoded text of an escape, or '' when the string is not a key.
    private function readEscape(bool $isKey): string
    {
        if ($this->position >= $this->length) {
            return '';
        }
        $escaped = $this->text[$this->position++];
        if (!$isKey) {
            return '';
        }
        if ($escaped !== 'u') {
            return self::SIMPLE_ESCAPES[$escaped] ?? $escaped;
        }

        $unit = $this->readHexUnit();
        if ($unit === null) {
            return $escaped;
        }
        if ($unit < 0xD800 || $unit > 0xDFFF) {
            return self::utf8($unit);
        }

        return $this->readSurrogatePair($unit);
    }

    // Four hex digits make a \u escape; anything else keeps the `u` as written, as the parser rejects it anyway.
    private function readHexUnit(): ?int
    {
        $digits = substr($this->text, $this->position, self::UNICODE_ESCAPE_DIGITS);
        if (strlen($digits) < self::UNICODE_ESCAPE_DIGITS || !ctype_xdigit($digits)) {
            return null;
        }
        $this->position += self::UNICODE_ESCAPE_DIGITS;

        return (int) hexdec($digits);
    }

    // A high surrogate followed by a \u low surrogate is one code point; a lone surrogate is U+FFFD.
    private function readSurrogatePair(int $high): string
    {
        $isHigh = $high <= 0xDBFF;
        if (!$isHigh || substr($this->text, $this->position, 2) !== '\\u') {
            return self::utf8(self::REPLACEMENT_CHARACTER);
        }

        $saved = $this->position;
        $this->position += 2;
        $low = $this->readHexUnit();
        if ($low === null || $low < 0xDC00 || $low > 0xDFFF) {
            $this->position = $saved;

            return self::utf8(self::REPLACEMENT_CHARACTER);
        }

        return self::utf8(0x10000 + (($high - 0xD800) << 10) + ($low - 0xDC00));
    }

    private static function utf8(int $codePoint): string
    {
        return match (true) {
            $codePoint < 0x80 => chr($codePoint),
            $codePoint < 0x800 => chr(0xC0 | ($codePoint >> 6)) . chr(0x80 | ($codePoint & 0x3F)),
            $codePoint < 0x10000 => chr(0xE0 | ($codePoint >> 12)) . chr(0x80 | (($codePoint >> 6) & 0x3F))
                . chr(0x80 | ($codePoint & 0x3F)),
            default => chr(0xF0 | ($codePoint >> 18)) . chr(0x80 | (($codePoint >> 12) & 0x3F))
                . chr(0x80 | (($codePoint >> 6) & 0x3F)) . chr(0x80 | ($codePoint & 0x3F)),
        };
    }
}
