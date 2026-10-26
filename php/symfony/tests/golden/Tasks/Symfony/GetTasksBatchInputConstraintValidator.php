<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\Checks;
use Seampact\Golden\Tasks\Symfony\Runtime\Format;
use Seampact\Golden\Tasks\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\Tasks\Symfony\Runtime\InputShape;
use Seampact\Golden\Tasks\Symfony\Runtime\JsonType;
use Seampact\Golden\Tasks\Symfony\Runtime\KeyPolicy;
use Seampact\Golden\Tasks\Symfony\Runtime\Member;
use Seampact\Golden\Tasks\Symfony\Runtime\PatternScope;
use Seampact\Golden\Tasks\Symfony\Runtime\Rule;
use Symfony\Component\Validator\Constraints\Count;
use Symfony\Component\Validator\Constraints\Uuid;

/**
 * The members of the input of operation 'getTasksBatch', as the contract declares them.
 */
final class GetTasksBatchInputConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return new InputShape(
            path: [
                'channelId' => new Member(
                    JsonType::String,
                    checks: new Checks(format: Format::Uuid, formatScope: PatternScope::EmptyStringOnly),
                    native: [new Uuid(payload: Rule::payload(Rule::FORMAT))],
                ),
            ],
            unknownQuery: KeyPolicy::Refuse,
            body: new Member(
                JsonType::Object,
                properties: [
                    'ids' => new Member(
                        JsonType::List,
                        native: [new Count(max: 200, payload: Rule::payload(Rule::MAX_ITEMS))],
                        items: new Member(
                            JsonType::String,
                            checks: new Checks(format: Format::Uuid, formatScope: PatternScope::EmptyStringOnly),
                            native: [new Uuid(payload: Rule::payload(Rule::FORMAT))],
                        ),
                    ),
                ],
            ),
        );
    }
}
