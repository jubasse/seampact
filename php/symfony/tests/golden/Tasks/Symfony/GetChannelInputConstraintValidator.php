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
 * The members of the input of operation 'getChannel', as the contract declares them.
 */
final class GetChannelInputConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return new InputShape(
            path: [
                'channelId' => new Member(
                    JsonType::String,
                    checks: new Checks(format: Format::Uuid),
                ),
            ],
            unknownQuery: KeyPolicy::Refuse,
        );
    }
}
