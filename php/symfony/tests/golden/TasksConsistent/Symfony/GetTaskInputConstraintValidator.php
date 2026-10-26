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

/**
 * The members of the input of operation 'getTask', as the contract declares them.
 */
final class GetTaskInputConstraintValidator extends InputConstraintValidator
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
      unknownQuery: KeyPolicy::Refuse,
    );
  }
}
