<?php

declare(strict_types=1);

namespace App\Suite;

/**
 * What a handler answers in place of its own result when the loaded script says so: its declared success built from
 * the script's body, one of its declared error arms, a thrown exception, or, for a status or code the result type
 * cannot hold, a reply the app writes itself (`ScriptedReply`), which the boundary's outgoing check judges.
 */
final class ScriptedAnswers
{
    private const API = 'tasks';

    private function __construct()
    {
    }

    /**
     * @template Result of object
     * @param \Closure(array<mixed>): Result $success builds the success from the script's body
     * @param array<string, \Closure(): Result> $errorArms the declared error arms, by code
     * @return Result|null null when the script gives the operation no answer
     */
    public static function answer(string $operation, int $successStatus, \Closure $success, array $errorArms = []): ?object
    {
        $answer = SuiteControl::scriptedAnswer(self::API, $operation);
        if ($answer === null) {
            return null;
        }

        if (isset($answer['throws'])) {
            throw new \RuntimeException(is_string($answer['throws']) ? $answer['throws'] : 'scripted failure');
        }

        $status = is_int($answer['status'] ?? null) ? $answer['status'] : 0;
        $code = is_string($answer['code'] ?? null) ? $answer['code'] : '';
        if ($code !== '' && isset($errorArms[$code])) {
            return $errorArms[$code]();
        }
        $body = $answer['body'] ?? null;
        if ($code === '' && $status === $successStatus && is_array($body)) {
            return $success($body);
        }

        throw new ScriptedReply($status, $code, $body);
    }
}
