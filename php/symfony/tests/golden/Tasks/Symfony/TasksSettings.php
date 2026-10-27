<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\ContractSettings;
use Seampact\Golden\Tasks\Symfony\Runtime\EnvValue;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * The 'seampact_tasks' bundle configuration, a literal value checked at the container build
 * and an `%env()%` one when the boundary reads it, so a value the configuration cannot hold is refused
 * naming its key and the accepted values, never the value.
 */
#[Exclude]
final readonly class TasksSettings implements ContractSettings
{
    public const ALIAS = 'seampact_tasks';
    private const RESPONSES_VALUES = ['strict', 'warn'];
    private const TRUE_TEXTS = ['true', '1'];
    private const FALSE_TEXTS = ['false', '0', ''];
    private const BODY_VALIDATION_REFUSAL = 'The bundle configuration key seampact_tasks.body_validation takes true or false.';

    /**
     * @param array<mixed> $operations
     */
    public function __construct(
        private mixed $responses,
        private mixed $bodyValidation,
        private array $operations,
        private mixed $publicOrigin = null,
    ) {
    }

    /**
     * The refusal of each literal value outside its values, for the container build; an `%env()%` value is
     * left to the run-time check.
     *
     * @param array<mixed> $config
     * @return list<string>
     */
    public static function literalRefusals(array $config, ContainerBuilder $container): array
    {
        $literals = ['seampact_tasks.responses' => $config['responses'] ?? null];
        $operations = $config['operations'] ?? [];
        foreach (is_array($operations) ? $operations : [] as $operationId => $operation) {
            if (is_array($operation) && ($operation['responses'] ?? null) !== null) {
                $literals["seampact_tasks.operations.{$operationId}.responses"] = $operation['responses'];
            }
        }

        $refusals = [];
        foreach ($literals as $key => $value) {
            if (self::responsesValue($value) === null && !EnvValue::isPlaceholder($container, $value)) {
                $refusals[] = self::responsesRefusal($key);
            }
        }

        $bodyValidation = $config['body_validation'] ?? null;
        if (self::bodyValidationOf($bodyValidation) === null && !EnvValue::isPlaceholder($container, $bodyValidation)) {
            $refusals[] = self::BODY_VALIDATION_REFUSAL;
        }

        return $refusals;
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

        return self::responsesValue($value) ?? throw new \UnexpectedValueException(self::responsesRefusal($key));
    }

    /**
     * Whether the outgoing check validates success bodies; an environment value is text.
     */
    public function bodyValidation(): bool
    {
        return self::bodyValidationOf($this->bodyValidation) ?? throw new \UnexpectedValueException(self::BODY_VALIDATION_REFUSAL);
    }

    /**
     * The mode, or null for a value outside the modes.
     */
    private static function responsesValue(mixed $value): ?string
    {
        return is_string($value) && in_array($value, self::RESPONSES_VALUES, true) ? $value : null;
    }

    private static function responsesRefusal(string $key): string
    {
        return "The bundle configuration key {$key} takes 'strict' or 'warn'.";
    }

    /**
     * A boolean, or its text as an environment value gives it; null for any other value.
     */
    private static function bodyValidationOf(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_string($value) && in_array(strtolower($value), self::TRUE_TEXTS, true)) {
            return true;
        }

        if (is_string($value) && in_array(strtolower($value), self::FALSE_TEXTS, true)) {
            return false;
        }

        return null;
    }

    /**
     * The api writes relative URLs, so no origin is set, as the boot check requires.
     */
    public function publicOrigin(): ?string
    {
        if ($this->publicOrigin !== null && $this->publicOrigin !== '') {
            throw new \UnexpectedValueException('The bundle configuration key seampact_tasks.public_origin is set, but the api writes relative URLs: remove it, or set api.wire.urls: absolute in the contract.');
        }

        return null;
    }
}
