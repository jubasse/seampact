<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\WireCodec;

/**
 * The FormRequest's side of the check order: a failed validation becomes the operation's `schemaInvalid` 400 with
 * every issue, the generated rule objects' and Laravel's own rules' mapped to contract rule names; a passed one runs
 * step 7 (input field rights) and builds the typed input the handler reads with `contractInput()`.
 */
final class FormSteps
{
    public const MAX_RENDERED_ISSUES = 100;

    private function __construct()
    {
    }

    /** @param array<string, array<string, string>> $nativeRuleNames */
    public static function failed(Request $request, string $api, Validator $validator, array $nativeRuleNames): ContractRefusal
    {
        $state = BoundaryState::required($request, $api);
        $issues = [];
        foreach (InputTree::of($request, $api)->issues() as $issue) {
            $issues[] = ['in' => $issue->in, 'pointer' => $issue->pointer, 'rule' => $issue->rule];
        }

        $failed = $validator->failed();
        foreach ($failed as $attribute => $rules) {
            foreach (is_array($rules) ? array_keys($rules) : [] as $laravelRule) {
                $contractRule = self::nativeRule($nativeRuleNames, (string) $attribute, (string) $laravelRule);
                if ($contractRule !== null) {
                    $issues[] = self::issueAt((string) $attribute, $contractRule);
                }
            }
        }

        return AccessSteps::schemaInvalid($state, array_slice(self::unique($issues), 0, self::MAX_RENDERED_ISSUES));
    }

    /** Step 7, then the typed input of the operation. */
    public static function passed(Request $request, string $api): object
    {
        $state = BoundaryState::required($request, $api);
        FieldRights::input($state);

        $types = $state->contract->operationTypes($state->operationId);
        $operation = $state->contract->operation($state->operationId);
        $inputClass = Ir::string($types, 'input') ?? throw new \LogicException("seampact: no generated input class for operation '{$state->operationId}'.");
        $data = InputTree::of($request, $api)->parts();
        $arguments = [];
        foreach (Ir::map($types, 'parts') as $part => $partTypes) {
            $class = Ir::string($partTypes, 'class');
            if ($class === null) {
                continue;
            }
            $declared = self::paramMembers(Ir::maps(Ir::map($operation, 'params'), $part === 'headers' ? 'header' : $part));
            $values = $data[$part] ?? new \stdClass();
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

    /** @param array<string, array<string, string>> $nativeRuleNames */
    private static function nativeRule(array $nativeRuleNames, string $attribute, string $laravelRule): ?string
    {
        foreach ($nativeRuleNames as $pattern => $rules) {
            $regex = '/^' . str_replace('\*', '[^.]+', preg_quote($pattern, '/')) . '$/D';
            if (preg_match($regex, $attribute) === 1 && isset($rules[$laravelRule])) {
                return $rules[$laravelRule];
            }
        }

        return null;
    }

    /** @return array{in: string, pointer: string, rule: string} */
    private static function issueAt(string $attribute, string $rule): array
    {
        $segments = explode('.', $attribute);
        $part = (string) array_shift($segments);
        $pointer = implode('', array_map(static fn (string $segment): string => '/' . str_replace(['~', '/'], ['~0', '~1'], strtr($segment, ['~1' => '.', '~2' => '*', '~0' => '~'])), $segments));

        return ['in' => $part === 'headers' ? 'header' : $part, 'pointer' => $pointer, 'rule' => $rule];
    }

    /**
     * @param list<array{in: string, pointer: string, rule: string}> $issues
     * @return list<array{in: string, pointer: string, rule: string}>
     */
    private static function unique(array $issues): array
    {
        $seen = [];
        $unique = [];
        foreach ($issues as $issue) {
            $key = implode("\n", $issue);
            if (!isset($seen[$key])) {
                $seen[$key] = true;
                $unique[] = $issue;
            }
        }

        return $unique;
    }
}
