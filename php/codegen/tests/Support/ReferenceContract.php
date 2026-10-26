<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Run\FrameworkRoute;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;

/**
 * The reference contract's IRs as an entry's `operations` filter keeps them, read with a PHP target's IR support, and
 * that target's entries to generate them; shared by the PHP targets' tests through their `autoload-dev`.
 */
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

    public static function read(Generator $generator, \stdClass $document): ContractIR
    {
        return IrReader::readDocument($document, $generator->irSupport());
    }

    public static function core(Generator $generator): ContractIR
    {
        return self::read($generator, self::kept(self::document(self::TASKS), self::CORE_OPERATIONS));
    }

    /**
     * @param array<string, mixed> $options
     * @param array<string, mixed> $artefacts
     * @param list<FrameworkRoute> $frameworkRoutes
     */
    public static function entry(string $package, string $api, string $namespace, array $options = [], array $artefacts = [], array $frameworkRoutes = []): TargetEntry
    {
        return new TargetEntry('server', $package, $api, null, (object) $options, (object) $artefacts, '/app/generated', $namespace, $frameworkRoutes, null);
    }

    /** The one operation `$operationId` of the reference tasks IR, which `$change` edits in place. */
    public static function withOperation(string $operationId, \Closure $change): \stdClass
    {
        $document = self::kept(self::document(self::TASKS), [$operationId]);
        $operation = is_array($document->operations) ? ($document->operations[0] ?? null) : null;
        if (!$operation instanceof \stdClass) {
            throw new \LogicException("The reference IR has no operation '{$operationId}'.");
        }
        $change($operation, $document);

        return $document;
    }
}
