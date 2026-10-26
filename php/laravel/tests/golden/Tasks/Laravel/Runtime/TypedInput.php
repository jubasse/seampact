<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * Steps 7 and 8: the field rights on the input, then the operation's generated input built from the validated params
 * and the held body through the IR's wire form, kept in the state for the handler.
 */
final class TypedInput
{
    private function __construct()
    {
    }

    /** @param array<string, mixed> $parts the validated params by part (`path`, `query`, `headers`), each an object */
    public static function build(BoundaryState $state, array $parts): object
    {
        FieldRights::input($state);

        $types = $state->contract->operationTypes($state->operationId);
        $operation = $state->contract->operation($state->operationId);
        $inputClass = Ir::string($types, 'input') ?? throw new \LogicException("seampact: no generated input class for operation '{$state->operationId}'.");
        $arguments = [];
        foreach (Ir::map($types, 'parts') as $part => $partTypes) {
            $class = Ir::string($partTypes, 'class');
            if ($class === null) {
                continue;
            }
            $declared = self::paramMembers(Ir::maps(Ir::map($operation, 'params'), $part === 'headers' ? 'header' : $part));
            $values = $parts[$part] ?? new \stdClass();
            $arguments[$part] = new $class(...WireCodec::arguments($state->contract, Ir::map($partTypes, 'members'), $declared, $values instanceof \stdClass ? $values : new \stdClass()));
        }
        if (Ir::has($operation, 'input') && is_array($operation['input'])) {
            $arguments['body'] = WireCodec::decode($state->contract, Ir::map($operation['input'], 'schema'), $state->body);
        }

        return $state->contractInput = new $inputClass(...$arguments);
    }

    /**
     * Params read as object members: a required param is never optional, an optional one is absent when not sent.
     *
     * @param list<array<array-key, mixed>> $params
     * @return list<array<array-key, mixed>>
     */
    private static function paramMembers(array $params): array
    {
        return array_map(
            static fn (array $param): array => ['name' => $param['name'] ?? '', 'type' => $param['type'] ?? null, 'optional' => !Ir::true($param, 'required'), 'nullable' => false],
            $params,
        );
    }
}
