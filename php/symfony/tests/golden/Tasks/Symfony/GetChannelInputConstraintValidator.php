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
