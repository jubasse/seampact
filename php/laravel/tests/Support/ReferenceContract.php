<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests\Support;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Laravel\LaravelGenerator;

/** The reference contract's IRs as an entry's `operations` filter keeps them, and target entries to generate them. */
final class ReferenceContract
{
    public const TASKS = 'tasks.ir.json';

    // The tasks operations whose forms this release generates; the others carry paging, idempotency, cache headers or
    // a signed route, and the tasksService api's one operation a deadline and a relay, which a later release brings.
    public const CORE_OPERATIONS = ['health', 'getChannel', 'getDraft', 'getTask', 'getTasksBatch'];

    public static function repositoryRoot(): string
    {
        return dirname(__DIR__, 4);
    }

    public static function document(string $file): \stdClass
    {
        $document = json_decode((string) file_get_contents(self::repositoryRoot() . '/fixtures/golden/reference/' . $file), false, 512, JSON_THROW_ON_ERROR);
        if (!$document instanceof \stdClass) {
            throw new \LogicException("The reference IR {$file} is not a JSON object.");
        }

        return $document;
    }

    /** @param list<string> $operationIds */
    public static function kept(\stdClass $document, array $operationIds): \stdClass
    {
        $copy = json_decode(json_encode($document, JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
        if (!$copy instanceof \stdClass || !is_array($copy->operations)) {
            throw new \LogicException('The IR copy has no operations list.');
        }
        $copy->operations = array_values(array_filter($copy->operations, static fn (mixed $operation): bool => $operation instanceof \stdClass && in_array($operation->id, $operationIds, true)));

        return $copy;
    }

    public static function read(\stdClass $document): ContractIR
    {
        return IrReader::readDocument($document, (new LaravelGenerator())->irSupport());
    }

    public static function core(): ContractIR
    {
        return self::read(self::kept(self::document(self::TASKS), self::CORE_OPERATIONS));
    }

    /** @param array<string, mixed> $options */
    public static function entry(string $api, string $namespace, array $options = []): TargetEntry
    {
        return new TargetEntry('server', 'seampact/laravel', $api, null, (object) $options, new \stdClass(), '/app/generated', $namespace);
    }
}
