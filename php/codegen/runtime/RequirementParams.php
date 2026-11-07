<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\RequirementKind;

/** The params a decide request carries: the use site's values as the right's or rule's generated params class. */
final class RequirementParams
{
    private function __construct()
    {
    }

    /** Null for a right or rule that declares no params. */
    public static function of(ApiContract $contract, RequirementKind $kind, string $name, mixed $params): ?object
    {
        $member = $kind === RequirementKind::Rule ? 'rules' : 'rights';
        $schemaId = Ir::string($contract->declaration($member, $name), 'params');
        if ($schemaId === null) {
            return null;
        }

        $values = is_array($params) ? AccessSteps::asObject($params) : new \stdClass();
        $typed = WireCodec::decode($contract, ['kind' => 'ref', 'schema' => $schemaId], $values);
        if (!is_object($typed)) {
            throw new \LogicException("seampact: the params of '{$name}' decoded to " . get_debug_type($typed) . ', not its params class.');
        }

        return $typed;
    }
}
