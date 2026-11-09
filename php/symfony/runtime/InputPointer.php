<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\Ir;

/**
 * The wire pointer of an app rule's violation (ADR 0028 "Pointers"): a Symfony property path names code members
 * (`window.endDate`, `items[0].name`), and the walker maps each segment back to its wire name through the contract's
 * member tables, keeping array indices. A segment it cannot map points at the nearest mapped parent.
 */
final class InputPointer
{
    private const BODY = 'body';
    private const HEADERS = 'headers';
    private const HEADER_ISSUE_PART = 'header';
    private const PATH_TOKEN = '/\[([^\]]*)\]|([^.\[\]]+)/';

    private function __construct()
    {
    }

    /**
     * @param string $part `path`, `query`, `headers` or `body`
     * @return array{in: string, pointer: string}
     */
    public static function of(ApiContract $contract, string $operationId, string $part, string $propertyPath): array
    {
        $tokens = self::tokens($propertyPath);
        $operation = $contract->operation($operationId);

        if ($part === self::BODY) {
            $pointer = self::walkType($contract, Ir::map(Ir::map($operation, 'input'), 'schema'), $tokens);

            return ['in' => self::BODY, 'pointer' => $pointer];
        }

        $paramPart = $part === self::HEADERS ? 'header' : $part;
        $members = Ir::map(Ir::map(Ir::map($contract->operationTypes($operationId), 'parts'), $part), 'members');
        $pointer = self::walkMembers($contract, Ir::maps(Ir::map($operation, 'params'), $paramPart), $members, $tokens);

        // Header names are case-insensitive, so every target reports a header's pointer in lower case.
        return $part === self::HEADERS
            ? ['in' => self::HEADER_ISSUE_PART, 'pointer' => strtolower($pointer)]
            : ['in' => $part, 'pointer' => $pointer];
    }

    /** @return list<string> */
    private static function tokens(string $propertyPath): array
    {
        preg_match_all(self::PATH_TOKEN, $propertyPath, $matches, PREG_SET_ORDER);

        return array_map(static fn (array $match): string => $match[2] ?? $match[1] ?? '', $matches);
    }

    /** @param list<string> $tokens */
    private static function walkType(ApiContract $contract, mixed $type, array $tokens): string
    {
        if ($tokens === []) {
            return '';
        }

        $kind = Ir::string($type, 'kind');
        if ($kind === 'array' && ctype_digit($tokens[0])) {
            return '/' . $tokens[0] . self::walkType($contract, Ir::map($type, 'items'), array_slice($tokens, 1));
        }

        if ($kind !== 'ref') {
            return '';
        }

        $schemaId = Ir::string($type, 'schema') ?? '';
        $members = Ir::map(Ir::map(Ir::map($contract->types, 'schemas'), $schemaId), 'members');

        return self::walkMembers($contract, Ir::maps($contract->declaration('schemas', $schemaId), 'properties'), $members, $tokens);
    }

    /**
     * @param list<array<array-key, mixed>> $declared the members with their wire name and type
     * @param array<array-key, mixed> $members each wire name's PHP property
     * @param list<string> $tokens
     */
    private static function walkMembers(ApiContract $contract, array $declared, array $members, array $tokens): string
    {
        if ($tokens === []) {
            return '';
        }

        foreach ($declared as $member) {
            $wireName = Ir::string($member, 'name') ?? '';
            if (Ir::string($members, $wireName) !== $tokens[0]) {
                continue;
            }

            return '/' . InputWalk::escape($wireName) . self::walkType($contract, $member['type'] ?? null, array_slice($tokens, 1));
        }

        return '';
    }
}
