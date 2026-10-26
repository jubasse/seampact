<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrSupport;

/** The reference contract's tasks IR, as a JSON document to edit and as the model it reads to. */
final class ReferenceIr
{
    public static function document(): \stdClass
    {
        $text = file_get_contents(dirname(__DIR__, 4) . '/fixtures/golden/reference/tasks.ir.json');
        $document = is_string($text) ? json_decode($text, false, 512, JSON_THROW_ON_ERROR) : null;
        if (!$document instanceof \stdClass) {
            throw new \LogicException('The reference tasks IR is not a readable JSON object.');
        }

        return $document;
    }

    /**
     * The document with only the operations listed.
     *
     * @param list<string> $operationIds
     */
    public static function keeping(\stdClass $document, array $operationIds): \stdClass
    {
        $operations = is_array($document->operations) ? $document->operations : [];
        $document->operations = array_values(array_filter($operations, static fn (mixed $operation): bool => $operation instanceof \stdClass && in_array($operation->id, $operationIds, true)));

        return $document;
    }

    public static function read(\stdClass $document): ContractIR
    {
        return IrReader::readDocument($document, new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, ['httpOperation'], []));
    }
}
