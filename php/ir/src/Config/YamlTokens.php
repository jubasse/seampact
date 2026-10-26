<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * The plain scalars and tags of a YAML text, in block and flow context, for the forms two YAML readers read
 * differently: comments, quoted scalars, block scalars, anchors and aliases are skipped, so a `<<:` or a `0755`
 * inside them is text. A plain scalar is read up to the end of its line; a multi-line plain scalar gives one token
 * per line.
 */
final class YamlTokens
{
    private const FLOW_INDICATORS = ',[]{}';

    private const SPACES = " \t\r";

    private const DOCUMENT_MARKERS = ['---', '...'];

    private int $position = 0;

    private int $line = 1;

    private int $flowDepth = 0;

    /** @var list<YamlToken> */
    private array $tokens = [];

    private function __construct(private readonly string $text)
    {
    }

    /** @return list<YamlToken> */
    public static function of(string $text): array
    {
        $lexer = new self($text);

        while ($lexer->position < strlen($text)) {
            $lexer->step($text[$lexer->position]);
        }

        return $lexer->tokens;
    }

    private function step(string $character): void
    {
        if ($character === "\n") {
            $this->line++;
            $this->position++;
        } elseif (str_contains(self::SPACES, $character) || $this->isIndicator($character)) {
            $this->position++;
        } elseif ($character === '#' || ($character === '%' && $this->atLineStart())) {
            $this->skipToLineEnd();
        } elseif ($character === "'") {
            $this->skipSingleQuoted();
        } elseif ($character === '"') {
            $this->skipDoubleQuoted();
        } elseif (str_contains(self::FLOW_INDICATORS, $character) && ($this->flowDepth > 0 || $character === '[' || $character === '{')) {
            $this->flowIndicator($character);
        } elseif (($character === '|' || $character === '>') && $this->flowDepth === 0) {
            $this->skipBlockScalar();
        } elseif ($character === '&' || $character === '*') {
            $this->skipWord();
        } elseif ($character === '!') {
            $start = $this->position;
            $this->skipWord();
            $this->tokens[] = new YamlToken(substr($this->text, $start, $this->position - $start), $this->line, YamlTokenKind::Tag);
        } elseif ($this->atLineStart() && in_array(substr($this->text, $this->position, 3), self::DOCUMENT_MARKERS, true) && $this->endsWord($this->position + 3)) {
            $this->position += 3;
        } else {
            $this->plainScalar();
        }
    }

    // `-`, `?` and `:` are indicators when a space, the line end or (in flow) a flow indicator follows.
    private function isIndicator(string $character): bool
    {
        return in_array($character, ['-', '?', ':'], true) && $this->endsWord($this->position + 1);
    }

    private function endsWord(int $position): bool
    {
        if ($position >= strlen($this->text)) {
            return true;
        }

        $next = $this->text[$position];

        return $next === "\n" || str_contains(self::SPACES, $next) || ($this->flowDepth > 0 && str_contains(self::FLOW_INDICATORS, $next));
    }

    private function atLineStart(): bool
    {
        return $this->position === 0 || $this->text[$this->position - 1] === "\n";
    }

    private function skipToLineEnd(): void
    {
        $end = strpos($this->text, "\n", $this->position);
        $this->position = $end === false ? strlen($this->text) : $end;
    }

    private function skipSingleQuoted(): void
    {
        $this->position++;

        while ($this->position < strlen($this->text)) {
            $character = $this->text[$this->position++];
            if ($character === "\n") {
                $this->line++;
            } elseif ($character === "'" && ($this->text[$this->position] ?? '') === "'") {
                $this->position++;
            } elseif ($character === "'") {
                return;
            }
        }
    }

    private function skipDoubleQuoted(): void
    {
        $this->position++;

        while ($this->position < strlen($this->text)) {
            $character = $this->text[$this->position++];
            if ($character === "\n") {
                $this->line++;
            } elseif ($character === '\\') {
                $this->line += ($this->text[$this->position] ?? '') === "\n" ? 1 : 0;
                $this->position++;
            } elseif ($character === '"') {
                return;
            }
        }
    }

    private function flowIndicator(string $character): void
    {
        if ($character === '[' || $character === '{') {
            $this->flowDepth++;
        } elseif ($character === ']' || $character === '}') {
            $this->flowDepth = max(0, $this->flowDepth - 1);
        }

        $this->position++;
    }

    // A block scalar's lines are those indented more than the line holding its `|` or `>`, and the blank lines.
    private function skipBlockScalar(): void
    {
        $parentIndent = $this->indentOf($this->lineStart($this->position));
        $this->skipToLineEnd();

        while ($this->position < strlen($this->text)) {
            $nextLine = $this->position + 1;
            $lineEnd = strpos($this->text, "\n", $nextLine);
            $content = substr($this->text, $nextLine, ($lineEnd === false ? strlen($this->text) : $lineEnd) - $nextLine);

            if (trim($content, self::SPACES) !== '' && $this->indentOf($nextLine) <= $parentIndent) {
                return;
            }

            $this->line++;
            $this->position = $lineEnd === false ? strlen($this->text) : $lineEnd;
        }
    }

    private function lineStart(int $position): int
    {
        $previousNewLine = strrpos(substr($this->text, 0, $position), "\n");

        return $previousNewLine === false ? 0 : $previousNewLine + 1;
    }

    private function indentOf(int $lineStart): int
    {
        return strspn($this->text, ' ', $lineStart);
    }

    // An anchor, an alias or a tag: up to a space, the line end or (in flow) a flow indicator.
    private function skipWord(): void
    {
        do {
            $this->position++;
        } while (!$this->endsWord($this->position));
    }

    // A plain scalar ends at the line end, at ` #`, at `: ` (a key) and, in flow, at a flow indicator.
    private function plainScalar(): void
    {
        $start = $this->position;
        $kind = YamlTokenKind::Scalar;

        while ($this->position < strlen($this->text)) {
            $character = $this->text[$this->position];
            $previous = $this->position > $start ? $this->text[$this->position - 1] : '';

            if ($character === "\n" || ($character === '#' && str_contains(self::SPACES, $previous) && $previous !== '')) {
                break;
            }

            if ($character === ':' && $this->endsWord($this->position + 1)) {
                $kind = YamlTokenKind::Key;
                break;
            }

            if ($this->flowDepth > 0 && str_contains(self::FLOW_INDICATORS, $character)) {
                break;
            }

            $this->position++;
        }

        $this->tokens[] = new YamlToken(rtrim(substr($this->text, $start, $this->position - $start), self::SPACES), $this->line, $kind);
    }
}
