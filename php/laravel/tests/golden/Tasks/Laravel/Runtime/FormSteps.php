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

    /**
     * Step 7, the typed input of the operation with a paged list's limit filled in, then the idempotency claim: a replayed reply is thrown, so the handler
     * never runs.
     *
     * @throws ReplayedReply
     */
    public static function passed(Request $request, string $api): object
    {
        $state = BoundaryState::required($request, $api);
        $parts = InputTree::of($request, $api)->parts();
        $query = $parts['query'] ?? new \stdClass();
        $parts['query'] = PageReply::withFilledLimit($state, $query instanceof \stdClass ? $query : new \stdClass());
        $input = TypedInput::build($state, $parts);

        $replayed = IdempotencyStep::begin($state, $parts);
        if ($replayed !== null) {
            throw new ReplayedReply($replayed);
        }

        return $input;
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
        [$part, $pointer] = InputTree::placeOf($attribute);

        return ['in' => $part, 'pointer' => $pointer, 'rule' => $rule];
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
