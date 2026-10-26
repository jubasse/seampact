<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\Denial;
use Seampact\Codegen\Runtime\HookSelection;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\RequirementCall;
use Seampact\Codegen\Runtime\ScopeCall;
use Seampact\Codegen\Runtime\WireValues;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\Decision;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequirementKind;
use Seampact\Hooks\ScopeIdSource;
use Seampact\Hooks\ScopeResolution;
use Seampact\Hooks\SubjectRef;
use Symfony\Component\HttpFoundation\Request;

/**
 * Steps 2 to 5 of the check order (ADR 0012 "The check order"): authenticate with the identity's hook (and the CSRF
 * header a cookie credential needs), resolve the scopes, then ask the deciders for each requirement in declared
 * order, a rule's proof read from the body first. Each refusal is one of the operation's declared codes.
 */
final class AccessSteps
{
    private const BEARER_PREFIX = 'bearer ';
    private const UNAUTHENTICATED_ROLE = 'unauthenticated';
    private const CSRF_INVALID_ROLE = 'csrfInvalid';
    private const SCHEMA_INVALID_ROLE = 'schemaInvalid';
    private const OPTIONAL_ACCESS = 'optional';
    private const ANONYMOUS = 'anonymous';
    private const COOKIE = 'cookie';

    private function __construct()
    {
    }

    public static function run(Request $request, BoundaryState $state): void
    {
        self::authenticate($request, $state);
        self::resolveScopes($state);
        self::decideRequirements($state);
    }

    public static function operationRef(BoundaryState $state): OperationRef
    {
        return new OperationRef($state->contract->api, $state->operationId);
    }

    /** Asks the decider of `$name`; the framework's access denial (HookLookup::isAccessDenial()) is its first declared code. */
    public static function decide(BoundaryState $state, RequirementCall $call): Decision
    {
        $decider = HookSelection::decider($state->hooks, $state->contract, $call->name())
            ?? throw new \LogicException("seampact: the api '{$state->contract->api}' has no decider for '{$call->name()}'; register one as the target's guide says.");

        try {
            return $decider->decide($call);
        } catch (\Throwable $failure) {
            if (!$state->hooks->isAccessDenial($failure)) {
                throw $failure;
            }

            $kind = $call->kind() === RequirementKind::Rule ? 'rules' : 'rights';
            $code = Ir::strings($state->contract->declaration($kind, $call->name()), 'errors')[0] ?? null;
            if ($code === null) {
                throw new \LogicException("seampact: the {$kind} '{$call->name()}' declares no error code for a denial.");
            }

            return new \Seampact\Hooks\Decision\Denied(new Denial($code));
        }
    }

    /** The refusal of a hook's denial, whose code the operation must declare. */
    public static function refusalOf(BoundaryState $state, \Seampact\Hooks\ErrorCodeWithParams $denial): ContractRefusal
    {
        if (!$state->contract->declares($state->operationId, $denial->code())) {
            throw new \LogicException("seampact: a hook denied operation '{$state->operationId}' with '{$denial->code()}', which the operation does not declare.");
        }

        return new ContractRefusal($state->contract->api, $denial->code(), Replies::encodedParams($state->contract, $denial->code(), $denial->params()));
    }

    /** The code of a role the operation declares, or the api's 500 when it declares none. */
    public static function roleRefusal(BoundaryState $state, string $role, ?\stdClass $params = null): ContractRefusal
    {
        $code = $state->contract->roleCode($state->operationId, $role)
            ?? throw new \LogicException("seampact: operation '{$state->operationId}' declares no code for the role '{$role}'.");

        return new ContractRefusal($state->contract->api, $code, $params);
    }

    /** @param list<array{in: string, pointer: string, rule: string}> $issues */
    public static function schemaInvalid(BoundaryState $state, array $issues): ContractRefusal
    {
        $code = $state->contract->roleCode($state->operationId, self::SCHEMA_INVALID_ROLE)
            ?? throw new \LogicException("seampact: operation '{$state->operationId}' declares no code for the role 'schemaInvalid'.");

        return new ContractRefusal($state->contract->api, $code, Replies::roleParams($state->contract, $state->operationId, $code, self::SCHEMA_INVALID_ROLE, ['issues' => $issues]));
    }

    private static function authenticate(Request $request, BoundaryState $state): void
    {
        $operation = $state->contract->operation($state->operationId);
        $access = Ir::map($operation, 'access');
        $identity = Ir::string($access, 'identity');
        if ($identity === null) {
            return;
        }

        $optional = Ir::string($access, 'kind') === self::OPTIONAL_ACCESS;
        [$credentials, $onlyCookies] = self::credentials($state->contract, $access, $request);
        if ($credentials === []) {
            if ($optional) {
                return;
            }
            throw self::roleRefusal($state, self::UNAUTHENTICATED_ROLE);
        }

        $csrfHeader = Ir::string(Ir::map($operation, 'csrf'), 'header');
        $csrfToken = $csrfHeader === null ? null : $request->headers->get($csrfHeader);
        if ($csrfHeader !== null && $onlyCookies && ($csrfToken === null || $csrfToken === '')) {
            throw self::roleRefusal($state, self::CSRF_INVALID_ROLE);
        }

        $types = Ir::map(Ir::map($state->contract->types, 'identities'), $identity);
        $credentialsClass = Ir::string($types, 'credentials') ?? \stdClass::class;
        $arguments = [];
        foreach (Ir::map($types, 'schemes') as $scheme => $property) {
            if (is_string($property)) {
                $arguments[$property] = $credentials[(string) $scheme] ?? null;
            }
        }

        $hook = $state->hooks->authenticateHook($state->contract, $identity);
        $result = $hook->authenticate(new AuthenticateCall($identity, new $credentialsClass(...$arguments), $csrfToken, $state->view, self::operationRef($state)));
        if ($result instanceof AuthenticateResult\Authenticated) {
            $state->principal = $result->principal;

            return;
        }
        if (!$result instanceof AuthenticateResult\Denied) {
            throw new \LogicException("seampact: the authenticate hook of '{$identity}' answered neither Authenticated nor Denied.");
        }
        if ($optional && Ir::string($access, 'onRefused') === self::ANONYMOUS) {
            return;
        }

        throw self::refusalOf($state, $result->deny);
    }

    /**
     * Each credential the operation's schemes find, by scheme id, read from the raw headers: the app's
     * `EncryptCookies` never decides a contract credential.
     *
     * @param array<array-key, mixed> $access
     * @return array{array<string, string>, bool} the credentials, and whether every one found is a cookie
     */
    private static function credentials(ApiContract $contract, array $access, Request $request): array
    {
        $credentials = [];
        $onlyCookies = true;
        foreach (Ir::strings($access, 'schemes') as $schemeId) {
            $scheme = $contract->declaration('schemes', $schemeId);
            $name = Ir::string($scheme, 'name') ?? '';
            $value = match (Ir::string($scheme, 'kind')) {
                'bearer' => self::bearerToken($request),
                self::COOKIE => self::cookie($request, $name),
                'header' => $request->headers->get($name),
                default => throw new \LogicException('seampact: the credential scheme kind ' . var_export(Ir::string($scheme, 'kind'), true) . ' is not one the boundary reads.'),
            };
            if ($value === null || $value === '') {
                continue;
            }
            $credentials[$schemeId] = $value;
            if (Ir::string($scheme, 'kind') !== self::COOKIE) {
                $onlyCookies = false;
            }
        }

        return [$credentials, $onlyCookies];
    }

    private static function bearerToken(Request $request): ?string
    {
        $authorization = (string) $request->headers->get('Authorization', '');
        if (!str_starts_with(strtolower($authorization), self::BEARER_PREFIX)) {
            return null;
        }
        $token = trim(substr($authorization, strlen(self::BEARER_PREFIX)));

        return $token === '' ? null : $token;
    }

    private static function cookie(Request $request, string $name): ?string
    {
        foreach (explode(';', (string) $request->headers->get('Cookie', '')) as $pair) {
            $parts = explode('=', trim($pair), 2);
            if (count($parts) === 2 && $parts[0] === $name) {
                return $parts[1];
            }
        }

        return null;
    }

    private static function resolveScopes(BoundaryState $state): void
    {
        foreach (Ir::maps($state->contract->operation($state->operationId), 'scopes') as $entry) {
            $scope = Ir::string($entry, 'scope') ?? '';
            $idType = Ir::map($state->contract->declaration('scopes', $scope), 'idSchema');
            $id = self::pathValue($state, Ir::string(Ir::map($entry, 'source'), 'name') ?? '', $idType);
            $resolver = HookSelection::scopeResolver($state->hooks, $state->contract, $scope)
                ?? throw new \LogicException("seampact: the api '{$state->contract->api}' has no scope resolver for the scope '{$scope}'; register one as the target's guide says.");

            $resolution = $resolver->resolveScope(new ScopeCall($scope, new ScopeIdSource\Declared($id), $state->principal, $state->scopes));
            if ($resolution instanceof ScopeResolution\Resolved) {
                $state->scopes[] = $resolution->resolved;
                continue;
            }
            if (!$resolution instanceof ScopeResolution\Denied) {
                throw new \LogicException("seampact: the scope resolver of '{$scope}' answered neither Resolved nor Denied.");
            }

            throw self::refusalOf($state, $resolution->deny);
        }
    }

    /** A path parameter that a scope or a subject reads: decoded and checked by its type before any hook sees it. */
    private static function pathValue(BoundaryState $state, string $name, mixed $type): int|string
    {
        $value = WireValues::pathValue($state->rawParameters[$name] ?? '', $type);
        $rule = WireValues::scalarIssue($type, $value);
        if ($rule !== null) {
            throw self::schemaInvalid($state, [['in' => 'path', 'pointer' => '/' . $name, 'rule' => $rule]]);
        }

        if (!is_int($value) && !is_string($value)) {
            throw new \LogicException("seampact: the path parameter '{$name}' decoded to " . get_debug_type($value) . ', not an id.');
        }

        return $value;
    }

    private static function decideRequirements(BoundaryState $state): void
    {
        foreach (Ir::maps($state->contract->operation($state->operationId), 'requires') as $requirement) {
            $isRule = Ir::string($requirement, 'kind') === 'rule';
            $name = Ir::string($requirement, $isRule ? 'rule' : 'right') ?? '';
            $params = $requirement['params'] ?? null;
            $call = new RequirementCall(
                $isRule ? RequirementKind::Rule : RequirementKind::Right,
                $name,
                is_array($params) ? self::asObject($params) : null,
                $state->principal,
                self::subjectOf($state, Ir::map($requirement, 'subject'), $name),
                $state->scopes,
                $isRule ? self::proofOf($state, $name) : null,
                new Purpose\Route(),
                self::operationRef($state),
                $state->view,
            );

            $decision = self::decide($state, $call);
            if ($decision instanceof Decision\Denied) {
                throw self::refusalOf($state, $decision->deny);
            }
        }
    }

    /** @param array<array-key, mixed> $subject */
    public static function subjectOf(BoundaryState $state, array $subject, string $right): ?SubjectRef
    {
        $source = Ir::map($subject, 'source');
        if ($source === []) {
            return null;
        }

        $sourceName = Ir::string($source, 'name') ?? '';
        if (Ir::string($source, 'in') === 'scope') {
            foreach ($state->scopes as $resolved) {
                if ($resolved->scope === $sourceName) {
                    return new SubjectRef($sourceName, $resolved->id);
                }
            }

            return null;
        }

        $declared = Ir::map($state->contract->declaration('rights', $right), 'subject');

        return new SubjectRef(self::subjectType($declared), self::pathValue($state, $sourceName, Ir::map($declared, 'idSchema')));
    }

    /** @param array<array-key, mixed> $rightSubject */
    public static function subjectType(array $rightSubject): string
    {
        return Ir::string($rightSubject, 'scope') ?? implode('.', Ir::strings(Ir::map($rightSubject, 'type'), 'segments'));
    }

    /**
     * The body field a rule reads its proof from, checked first: an issue there is the `schemaInvalid` refusal before
     * the decider runs. A body that is absent or not an object gives no proof; step 6 refuses it.
     */
    private static function proofOf(BoundaryState $state, string $rule): mixed
    {
        $proof = Ir::map($state->contract->declaration('rules', $rule), 'proof');
        $name = Ir::string($proof, 'name');
        if ($name === null || !$state->body instanceof \stdClass) {
            return null;
        }

        $members = get_object_vars($state->body);
        $value = $members[$name] ?? null;
        $issue = array_key_exists($name, $members) ? WireValues::scalarIssue(Ir::map($proof, 'schema'), $value) : 'required';
        if ($issue !== null) {
            throw self::schemaInvalid($state, [['in' => 'body', 'pointer' => '/' . $name, 'rule' => $issue]]);
        }

        return $value;
    }

    /** @param array<array-key, mixed> $value */
    public static function asObject(array $value): \stdClass
    {
        $object = json_decode(json_encode($value, JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);

        return $object instanceof \stdClass ? $object : new \stdClass();
    }
}
