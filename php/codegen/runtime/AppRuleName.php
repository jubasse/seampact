<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The rule name an app input rule renders on the wire (ADR 0028 "The answer"): `app.<name>`, so it never collides with
 * a contract rule. A rule without a usable name renders `app.invalid`, and the fix is logged once per rule.
 */
final class AppRuleName
{
    public const INVALID = 'app.invalid';
    private const PREFIX = 'app.';
    private const USABLE_NAME = '/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/D';
    private const UUID_SHAPE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/Di';

    /** @var array<string, true> the rules whose fix was logged, by rule key */
    private static array $logged = [];

    private function __construct()
    {
    }

    public static function isUsable(string $name): bool
    {
        return preg_match(self::USABLE_NAME, $name) === 1 && !self::isUuidShaped($name);
    }

    /** Symfony's built-in constraints set a UUID as their violation code; it is no name an app gave. */
    public static function isUuidShaped(string $name): bool
    {
        return preg_match(self::UUID_SHAPE, $name) === 1;
    }

    /**
     * @param string $ruleKey what tells one rule from another, the log-once key
     * @param ?string $name the name the library gave the rule, null when it gave none
     * @param string $fix how the app gives the rule a name, ending the log line
     */
    public static function rendered(BoundaryState $state, string $ruleKey, ?string $name, string $fix): string
    {
        if ($name !== null && self::isUsable($name)) {
            return self::PREFIX . $name;
        }

        $logKey = "{$state->contract->api}\n{$state->operationId}\n{$ruleKey}";
        if (!isset(self::$logged[$logKey])) {
            self::$logged[$logKey] = true;
            $state->hooks->logger()->warning("seampact: api '{$state->contract->api}' operation '{$state->operationId}': an input rule ({$ruleKey}) has no usable name, so it answers '" . self::INVALID . "'; {$fix}");
        }

        return self::INVALID;
    }
}
