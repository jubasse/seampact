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

/**
 * The members of the input of operation 'getDraft', as the contract declares them.
 */
final class GetDraftInputConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return new InputShape(
            path: [
                'draftId' => new Member(
                    JsonType::String,
                    checks: new Checks(format: Format::Uuid),
                ),
            ],
            unknownQuery: KeyPolicy::Refuse,
        );
    }
}
