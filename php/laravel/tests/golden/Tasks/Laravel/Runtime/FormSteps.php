<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Request;

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
        return TypedInput::build(BoundaryState::required($request, $api), InputTree::of($request, $api)->parts());
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
