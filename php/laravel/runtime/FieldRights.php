<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Container\Container;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\RequirementCall;
use Seampact\Hooks\Decision;
use Seampact\Hooks\FieldDirection;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequirementKind;
use Seampact\Hooks\SubjectRef;

/**
 * Field rights (ADR 0012 "Field rights"): step 7 refuses a restricted top-level input member sent without its right,
 * or removes it under `inputPolicy: strip`; before a success is written, each restricted output member whose right
 * the decider denies for its holder is removed, one decision per right and subject.
 */
final class FieldRights
{
    private const INPUT = 'input';
    private const OUTPUT = 'output';
    private const STRIP = 'strip';
    private const FORBIDDEN_ROLE = 'forbidden';
    private const WILDCARD = '*';

    private function __construct()
    {
    }

    public static function input(BoundaryState $state): void
    {
        $body = $state->body;
        if (!$body instanceof \stdClass) {
            return;
        }

        foreach (Ir::maps($state->contract->operation($state->operationId), 'fieldRights') as $fieldRight) {
            if (Ir::string($fieldRight, 'direction') !== self::INPUT) {
                continue;
            }
            $pointer = Ir::string($fieldRight, 'pointer') ?? '';
            $member = str_replace(['~1', '~0'], ['/', '~'], substr($pointer, 1));
            if (!property_exists($body, $member)) {
                continue;
            }

            $right = Ir::string($fieldRight, 'right') ?? '';
            $decision = AccessSteps::decide(Container::getInstance(), $state, self::call($state, $fieldRight, $right, AccessSteps::subjectOf($state, Ir::map($fieldRight, 'subject'), $right), FieldDirection::Input));
            if (!$decision instanceof Decision\Denied) {
                continue;
            }
            if (Ir::string($fieldRight, 'inputPolicy') === self::STRIP) {
                unset($body->{$member});
                continue;
            }

            $refusal = AccessSteps::refusalOf($state, $decision->deny);
            $rendered = Replies::roleParams($state->contract, $state->operationId, $refusal->contractCode, self::FORBIDDEN_ROLE, ['pointer' => $pointer]);
            $params = $refusal->params ?? new \stdClass();
            foreach (get_object_vars($rendered ?? new \stdClass()) as $name => $value) {
                $params->{$name} = $value;
            }
            throw new ContractRefusal($state->contract->api, $refusal->contractCode, $params);
        }
    }

    /** @param array<array-key, mixed> $response */
    public static function output(BoundaryState $state, array $response, mixed $body): mixed
    {
        $decisions = [];
        foreach (Ir::maps($state->contract->operation($state->operationId), 'fieldRights') as $fieldRight) {
            if (Ir::string($fieldRight, 'direction') !== self::OUTPUT || Ir::string($fieldRight, 'schema') !== Ir::string(Ir::map($response, 'body'), 'schema')) {
                continue;
            }
            $segments = explode('/', substr(Ir::string($fieldRight, 'pointer') ?? '', 1));
            $member = (string) array_pop($segments);
            foreach (self::instances($body, Ir::string($response, 'shape')) as $instance) {
                foreach (self::holders($instance, $segments) as $holder) {
                    if (property_exists($holder, $member) && !self::allowed($state, $fieldRight, $holder, $decisions)) {
                        unset($holder->{$member});
                    }
                }
            }
        }

        return $body;
    }

    /** @return list<mixed> a table's values and a list's items are each an instance of the body's schema */
    private static function instances(mixed $body, ?string $shape): array
    {
        return match ($shape) {
            'table' => $body instanceof \stdClass ? array_values(get_object_vars($body)) : [],
            'list', 'page' => is_array($body) ? array_values($body) : [],
            default => [$body],
        };
    }

    /**
     * @param list<string> $segments
     * @return list<\stdClass>
     */
    private static function holders(mixed $instance, array $segments): array
    {
        $current = [$instance];
        foreach ($segments as $segment) {
            $next = [];
            foreach ($current as $node) {
                if ($segment === self::WILDCARD && is_array($node)) {
                    array_push($next, ...array_values($node));
                } elseif ($node instanceof \stdClass && property_exists($node, $segment)) {
                    $next[] = $node->{$segment};
                }
            }
            $current = $next;
        }

        return array_values(array_filter($current, static fn (mixed $node): bool => $node instanceof \stdClass));
    }

    /**
     * @param array<array-key, mixed> $fieldRight
     * @param array<string, bool> $decisions
     */
    private static function allowed(BoundaryState $state, array $fieldRight, \stdClass $holder, array &$decisions): bool
    {
        $right = Ir::string($fieldRight, 'right') ?? '';
        $subject = null;
        $source = Ir::map(Ir::map($fieldRight, 'subject'), 'source');
        $holderValues = get_object_vars($holder);
        $holderId = $holderValues[Ir::string($source, 'name') ?? ''] ?? null;
        if (Ir::string($source, 'in') === 'holderField' && (is_string($holderId) || is_int($holderId))) {
            $subject = new SubjectRef(AccessSteps::subjectType(Ir::map($state->contract->declaration('rights', $right), 'subject')), $holderId);
        }

        $key = $right . "\n" . ($subject === null ? '' : (string) (is_object($subject->id) ? spl_object_id($subject->id) : $subject->id));
        if (!isset($decisions[$key])) {
            $decision = AccessSteps::decide(Container::getInstance(), $state, self::call($state, $fieldRight, $right, $subject, FieldDirection::Output));
            $decisions[$key] = $decision instanceof Decision\Allowed;
        }

        return $decisions[$key];
    }

    /** @param array<array-key, mixed> $fieldRight */
    private static function call(BoundaryState $state, array $fieldRight, string $right, ?SubjectRef $subject, FieldDirection $direction): RequirementCall
    {
        $params = $fieldRight['params'] ?? null;

        return new RequirementCall(
            RequirementKind::Right,
            $right,
            is_array($params) ? AccessSteps::asObject($params) : null,
            $state->principal,
            $subject,
            $state->scopes,
            null,
            new Purpose\Field(Ir::string($fieldRight, 'pointer') ?? '', $direction),
            AccessSteps::operationRef($state),
            $state->view,
        );
    }
}
