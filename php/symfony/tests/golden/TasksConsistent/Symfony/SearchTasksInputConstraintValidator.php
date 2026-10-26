<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\Checks;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Format;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputShape;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\JsonType;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\KeyPolicy;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Member;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Presence;

/**
 * The members of the input of operation 'searchTasks', as the contract declares them.
 */
final class SearchTasksInputConstraintValidator extends InputConstraintValidator
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
      body: new Member(
        JsonType::Object,
        properties: [
          'text' => new Member(
            JsonType::String,
            presence: Presence::Optional,
            checks: new Checks(maxLength: 200),
          ),
          'states' => new Member(
            JsonType::List,
            presence: Presence::Optional,
            checks: new Checks(maxItems: 3),
            items: new Member(
              JsonType::String,
              checks: new Checks(enumValues: ['open', 'done', 'archived']),
            ),
          ),
        ],
      ),
    );
  }
}
