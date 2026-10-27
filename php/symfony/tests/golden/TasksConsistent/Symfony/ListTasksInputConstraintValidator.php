<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Codegen\Runtime\Presence;
use Seampact\Symfony\Runtime\Checks;
use Seampact\Symfony\Runtime\Format;
use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;

/**
 * The members of the input of operation 'listTasks', as the contract declares them.
 */
final class ListTasksInputConstraintValidator extends InputConstraintValidator
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
      query: [
        'cursor' => new Member(
          JsonType::String,
          presence: Presence::Optional,
        ),
        'limit' => new Member(
          JsonType::Integer,
          presence: Presence::Optional,
          checks: new Checks(minimum: 1, maximum: 50),
        ),
        'sort' => new Member(
          JsonType::List,
          presence: Presence::Optional,
          items: new Member(
            JsonType::String,
            checks: new Checks(pattern: '/^(?:createdAt|-createdAt)$/uD'),
          ),
        ),
      ],
      unknownQuery: KeyPolicy::Refuse,
    );
  }
}
