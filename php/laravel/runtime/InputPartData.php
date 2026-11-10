<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\WireCodec;

/**
 * One part of the handler's typed input as the validator reads it (ADR 0028 section 2, Written in the configured library only): an array keyed
 * by wire name, written back through the generated member names, so step 7's strip, the served limit and the sent
 * version are in and the body's proof fields are out. A header's key is lower case. PHP arrays copy by value, so a
 * rule that changes its data changes nothing of the handler's input.
 */
final class InputPartData
{
    private const BODY = 'body';
    private const HEADERS = 'headers';
    private const HEADER_PARAMS = 'header';

    private function __construct()
    {
    }

    /** @return array<array-key, mixed> */
    public static function of(BoundaryState $state, object $input, string $part): array
    {
        $held = get_object_vars($input)[$part] ?? null;
        $encoded = $part === self::BODY ? self::body($state, $held) : self::params($state, $held, $part);

        $data = InputTree::asArrays($encoded);

        return is_array($data) ? $data : [];
    }

    private static function body(BoundaryState $state, mixed $held): mixed
    {
        $type = Ir::map(Ir::map($state->contract->operation($state->operationId), 'input'), 'schema');

        return WireCodec::encode($state->contract, $type, $held);
    }

    private static function params(BoundaryState $state, mixed $held, string $part): \stdClass
    {
        $values = is_object($held) ? get_object_vars($held) : [];
        $members = Ir::map(Ir::map(Ir::map($state->contract->operationTypes($state->operationId), 'parts'), $part), 'members');
        $declared = Ir::maps(Ir::map($state->contract->operation($state->operationId), 'params'), $part === self::HEADERS ? self::HEADER_PARAMS : $part);

        $data = new \stdClass();
        foreach ($declared as $param) {
            $wireName = Ir::string($param, 'name') ?? '';
            $value = $values[Ir::string($members, $wireName) ?? ''] ?? null;
            // An optional parameter that was not sent is absent, not null.
            if ($value === null) {
                continue;
            }
            $data->{$part === self::HEADERS ? strtolower($wireName) : $wireName} = WireCodec::encode($state->contract, $param['type'] ?? null, $value);
        }

        return $data;
    }
}
