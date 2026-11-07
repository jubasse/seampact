<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

use Seampact\Hooks\ThrottleBucket;

/**
 * The sample app's side of the suite's control routes (ADR 0015 "The shared black-box HTTP suite"): the script a case
 * loads, the hook calls the doubles record and the log lines the app writes. PHP's built-in server runs each request
 * in a fresh state, so all three live in one JSON file the app names, read and written under a lock.
 *
 * @phpstan-type RecordedBucket array{id: string, values: list<mixed>, limit?: int, windowMs?: int}
 * @phpstan-type HookCall array{hook: string, operation: string, bucket?: RecordedBucket}
 */
final class SuiteControl
{
    private const SCRIPT_MEMBERS = ['decisions', 'scopes', 'answers', 'holds'];
    private const HOLD_HOOK = 'hold';
    // Below the suite's request timeout, so a hold the suite never releases still answers.
    private const HOLD_LIMIT_MICROSECONDS = 5_000_000;
    private const HOLD_POLL_MICROSECONDS = 10_000;

    private function __construct()
    {
    }

    /** Loads the JSON `$body` as the script and empties the records, or names why it is not one. */
    public static function load(string $body): ?string
    {
        $decoded = json_decode($body);
        if (!$decoded instanceof \stdClass) {
            return 'the script is not a JSON object';
        }

        /** @var array<string, mixed> $script */
        $script = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        foreach (array_keys($script) as $member) {
            if (!in_array($member, self::SCRIPT_MEMBERS, true)) {
                return "the script member '{$member}' is not one of " . implode(', ', self::SCRIPT_MEMBERS);
            }
        }

        self::update(static fn (array $state): array => ['script' => $script, 'recording' => true, 'hookCalls' => [], 'logLines' => []]);

        return null;
    }

    /** @return list<HookCall> */
    public static function hookCalls(): array
    {
        return self::read()['hookCalls'];
    }

    /** @return list<string> */
    public static function logLines(): array
    {
        return self::read()['logLines'];
    }

    /** Records a hook call, and the bucket a decide call received, its key digest left out. */
    public static function recordHookCall(string $hook, string $api, string $operation, ?ThrottleBucket $bucket = null): void
    {
        $call = ['hook' => $hook, 'operation' => "{$api}.{$operation}"];
        if ($bucket !== null) {
            $call['bucket'] = self::recordedBucket($bucket);
        }

        self::update(static function (array $state) use ($call): array {
            if ($state['recording']) {
                $state['hookCalls'][] = $call;
            }

            return $state;
        });
    }

    /** @return RecordedBucket */
    private static function recordedBucket(ThrottleBucket $bucket): array
    {
        $recorded = ['id' => $bucket->id, 'values' => array_values($bucket->values)];
        if ($bucket->limit !== null) {
            $recorded['limit'] = $bucket->limit;
        }
        if ($bucket->windowMs !== null) {
            $recorded['windowMs'] = $bucket->windowMs;
        }

        return $recorded;
    }

    public static function writeLogLine(string $line): void
    {
        self::update(static function (array $state) use ($line): array {
            $state['logLines'][] = $line;

            return $state;
        });
    }

    /** The denial code the script gives a decide call of `$name` for `$purpose` (`route`, `field`, `sortKey`). */
    public static function scriptedDecision(string $name, string $purpose): ?string
    {
        foreach (self::scriptList('decisions') as $decision) {
            $purposeMatches = !isset($decision['purpose']) || $decision['purpose'] === $purpose;
            if (($decision['name'] ?? null) === $name && $purposeMatches) {
                return self::denialCode($decision);
            }
        }

        return null;
    }

    public static function scriptedScopeDenial(string $scope): ?string
    {
        $scopes = self::read()['script']['scopes'] ?? [];
        $scripted = is_array($scopes) ? ($scopes[$scope] ?? null) : null;

        return is_array($scripted) ? self::denialCode($scripted) : null;
    }

    /**
     * The answer the script gives an operation's handler in place of its own.
     *
     * @return array<mixed>|null
     */
    public static function scriptedAnswer(string $api, string $operation): ?array
    {
        $answers = self::read()['script']['answers'] ?? [];
        $answer = is_array($answers) ? ($answers["{$api}.{$operation}"] ?? null) : null;

        return is_array($answer) ? $answer : null;
    }

    /** Whether the script holds the operation's handler until a script that does not is loaded. */
    public static function isHeld(string $api, string $operation): bool
    {
        $holds = self::read()['script']['holds'] ?? [];

        return is_array($holds) && in_array("{$api}.{$operation}", $holds, true);
    }

    /** Records the hold, then waits until the operation is released or the hold limit has passed. */
    public static function waitForRelease(string $api, string $operation): void
    {
        self::recordHookCall(self::HOLD_HOOK, $api, $operation);

        $deadline = hrtime(true) / 1000 + self::HOLD_LIMIT_MICROSECONDS;
        while (self::isHeld($api, $operation) && hrtime(true) / 1000 < $deadline) {
            usleep(self::HOLD_POLL_MICROSECONDS);
        }
    }

    /** @return list<array<mixed>> */
    private static function scriptList(string $member): array
    {
        $list = self::read()['script'][$member] ?? [];

        return is_array($list) ? array_values(array_filter($list, is_array(...))) : [];
    }

    /** @param array<mixed> $scripted */
    private static function denialCode(array $scripted): string
    {
        $deny = $scripted['deny'] ?? null;
        $code = is_array($deny) ? ($deny['code'] ?? null) : null;
        if (!is_string($code)) {
            throw new \UnexpectedValueException('the loaded script holds a denial without a code');
        }

        return $code;
    }

    /** @return array{script: array<string, mixed>, recording: bool, hookCalls: list<HookCall>, logLines: list<string>} */
    private static function read(): array
    {
        return self::locked(LOCK_SH, static fn ($handle): array => self::decode($handle));
    }

    /** @param \Closure(array{script: array<string, mixed>, recording: bool, hookCalls: list<HookCall>, logLines: list<string>}): array<string, mixed> $change */
    private static function update(\Closure $change): void
    {
        self::locked(LOCK_EX, static function ($handle) use ($change): array {
            $state = $change(self::decode($handle));
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));

            return [];
        });
    }

    /**
     * @template T
     * @param int<0, 7> $operation
     * @param \Closure(resource): T $use
     * @return T
     */
    private static function locked(int $operation, \Closure $use): mixed
    {
        $path = SuiteFiles::controlStatePath();
        $handle = fopen($path, 'c+');
        if ($handle === false || !flock($handle, $operation)) {
            throw new \RuntimeException("the suite control state {$path} cannot be opened and locked");
        }

        try {
            return $use($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * @param resource $handle
     * @return array{script: array<string, mixed>, recording: bool, hookCalls: list<HookCall>, logLines: list<string>}
     */
    private static function decode($handle): array
    {
        $contents = stream_get_contents($handle, -1, 0);
        if ($contents === false || $contents === '') {
            return ['script' => [], 'recording' => false, 'hookCalls' => [], 'logLines' => []];
        }

        /** @var array{script: array<string, mixed>, recording: bool, hookCalls: list<HookCall>, logLines: list<string>} */
        return json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    }
}
