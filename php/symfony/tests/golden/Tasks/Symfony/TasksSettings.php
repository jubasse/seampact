<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

/**
 * The 'seampact_tasks' bundle configuration, each value checked when the boundary reads it, so a value
 * the configuration cannot hold is refused naming its key and the accepted values, never the value.
 */
final readonly class TasksSettings
{
    private const RESPONSES_VALUES = ['strict', 'warn'];
    private const TRUE_TEXTS = ['true', '1'];
    private const FALSE_TEXTS = ['false', '0', ''];

    /**
     * @param array<mixed> $operations
     */
    public function __construct(
        private mixed $responses,
        private mixed $bodyValidation,
        private array $operations,
    ) {
    }

    /**
     * The outgoing check's mode of an operation: its own value, else the api's.
     */
    public function responsesOf(string $operationId): string
    {
        $operation = $this->operations[$operationId] ?? null;
        $own = is_array($operation) ? ($operation['responses'] ?? null) : null;
        $value = $own ?? $this->responses;
        $key = $own === null ? 'seampact_tasks.responses' : "seampact_tasks.operations.{$operationId}.responses";
        if (!is_string($value) || !in_array($value, self::RESPONSES_VALUES, true)) {
            throw new \UnexpectedValueException("The bundle configuration key {$key} takes 'strict' or 'warn'.");
        }

        return $value;
    }

    /**
     * Whether the outgoing check validates success bodies; an environment value is text.
     */
    public function bodyValidation(): bool
    {
        $value = $this->bodyValidation;
        if (is_bool($value)) {
            return $value;
        }

        if (is_string($value) && in_array(strtolower($value), self::TRUE_TEXTS, true)) {
            return true;
        }

        if (is_string($value) && in_array(strtolower($value), self::FALSE_TEXTS, true)) {
            return false;
        }

        throw new \UnexpectedValueException('The bundle configuration key seampact_tasks.body_validation takes true or false.');
    }
}
