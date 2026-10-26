<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/**
 * The members of an authenticated principal the boundary reads (ADR 0023 "Keys"): only those the contract declares,
 * through the accessors of the identity's generated interface, which the generated principal class implements. The
 * idempotency partition and a principal bucket key come from them, so two callers never share a key because their
 * principal has no readable state.
 */
final class PrincipalMembers
{
    private function __construct()
    {
    }

    /** @return array<string, mixed> each declared member's value, by wire name */
    public static function read(ApiContract $contract, string $identity, object $principal): array
    {
        $types = Ir::map(Ir::map($contract->types, 'identities'), $identity);
        $interface = Ir::string($types, 'principalMembers')
            ?? throw new \LogicException("seampact: the contract class of api '{$contract->api}' names no principal members interface for identity '{$identity}'; regenerate it.");
        if (!$principal instanceof $interface) {
            throw new \LogicException("seampact: the authenticate hook of identity '{$identity}' returned a " . $principal::class . ", which does not implement {$interface}; return the generated principal class or implement that interface.");
        }

        $accessors = Ir::map($types, 'principalAccessors');
        if ($accessors === []) {
            throw new \LogicException("seampact: the principal of identity '{$identity}' declares no member, so its callers cannot be told apart; regenerate the contract class.");
        }

        $members = [];
        foreach ($accessors as $name => $accessor) {
            if (!is_string($accessor) || !method_exists($principal, $accessor)) {
                throw new \LogicException("seampact: the principal members interface of identity '{$identity}' has no accessor for '{$name}'; regenerate it.");
            }
            $value = $principal->{$accessor}();
            // An enum member keys a partition or a bucket by its wire value.
            $members[(string) $name] = $value instanceof \BackedEnum ? $value->value : $value;
        }

        return $members;
    }
}
