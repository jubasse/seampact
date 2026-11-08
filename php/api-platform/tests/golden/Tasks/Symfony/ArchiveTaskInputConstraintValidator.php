<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Symfony\Runtime\Checks;
use Seampact\Symfony\Runtime\Format;
use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;
use Seampact\Symfony\Runtime\Rule;
use Symfony\Component\Validator\Constraints\GreaterThanOrEqual;
use Symfony\Component\Validator\Constraints\Length;

/**
 * The members of the input of operation 'archiveTask', as the contract declares them.
 */
final class ArchiveTaskInputConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return new InputShape(
            path: [
                'channelId' => new Member(
                    JsonType::String,
                    checks: new Checks(format: Format::Uuid),
                ),
                'taskId' => new Member(
                    JsonType::String,
                    checks: new Checks(format: Format::Uuid),
                ),
            ],
            header: [
                'Idempotency-Key' => new Member(JsonType::String),
            ],
            unknownQuery: KeyPolicy::Refuse,
            body: new Member(
                JsonType::Object,
                properties: [
                    'reason' => new Member(
                        JsonType::String,
                        native: [new Length(min: 1, payload: Rule::payload(Rule::MIN_LENGTH)), new Length(max: 500, payload: Rule::payload(Rule::MAX_LENGTH))],
                    ),
                    'expectedVersion' => new Member(
                        JsonType::Integer,
                        native: [new GreaterThanOrEqual(value: 1, payload: Rule::payload(Rule::MINIMUM))],
                    ),
                ],
            ),
        );
    }
}
