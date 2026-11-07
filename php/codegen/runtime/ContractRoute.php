<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/** One contract operation as the boundary matches it: its method and its path template split into segments. */
final readonly class ContractRoute
{
    private const PARAMETER = '/^\{([^{}]+)\}$/';

    /** @param list<array{literal: bool, text: string}> $segments */
    private function __construct(public string $operationId, public string $method, public array $segments, public string $basePath)
    {
    }

    /** @param array<array-key, mixed> $operation */
    public static function of(array $operation, string $mount, string $basePath): self
    {
        $segments = [];
        foreach (array_slice(explode('/', $mount . (Ir::string($operation, 'path') ?? '')), 1) as $segment) {
            $segments[] = preg_match(self::PARAMETER, $segment, $parameter) === 1
                ? ['literal' => false, 'text' => $parameter[1]]
                : ['literal' => true, 'text' => $segment];
        }

        return new self(Ir::string($operation, 'id') ?? '', strtoupper(Ir::string($operation, 'method') ?? ''), $segments, $basePath);
    }

    /**
     * The raw path parameters when `$rawSegments` match the template: a literal segment matches its text exactly,
     * undecoded; a parameter matches any segment that is not empty, holds no `;` and is no dot segment once decoded.
     *
     * @param list<string> $rawSegments
     * @return array<string, string>|null
     */
    public function match(array $rawSegments): ?array
    {
        if (count($rawSegments) !== count($this->segments)) {
            return null;
        }

        $parameters = [];
        foreach ($this->segments as $index => $segment) {
            $raw = $rawSegments[$index];
            if ($segment['literal']) {
                if ($raw !== $segment['text']) {
                    return null;
                }
                continue;
            }

            if ($raw === '' || str_contains($raw, ';') || in_array(rawurldecode($raw), ['.', '..'], true)) {
                return null;
            }
            $parameters[$segment['text']] = $raw;
        }

        return $parameters;
    }

    /** Literal segments sort before parameters at the first segment where two templates differ. */
    public static function mostSpecificFirst(self $first, self $second): int
    {
        foreach ($first->segments as $index => $segment) {
            $other = $second->segments[$index] ?? null;
            if ($other === null) {
                return 1;
            }
            if ($segment['literal'] !== $other['literal']) {
                return $segment['literal'] ? -1 : 1;
            }
        }

        return count($first->segments) <=> count($second->segments);
    }
}
