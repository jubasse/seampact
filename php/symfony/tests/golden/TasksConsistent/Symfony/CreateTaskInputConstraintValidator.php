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
 * The members of the input of operation 'createTask', as the contract declares them.
 */
final class CreateTaskInputConstraintValidator extends InputConstraintValidator
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
      header: [
        'Idempotency-Key' => new Member(JsonType::String),
      ],
      unknownQuery: KeyPolicy::Refuse,
      body: new Member(
        JsonType::Object,
        properties: [
          'title' => new Member(
            JsonType::String,
            checks: new Checks(minLength: 1, maxLength: 200),
          ),
          'effort' => new Member(
            JsonType::Integer,
            presence: Presence::Optional,
            checks: new Checks(minimum: 0),
          ),
        ],
      ),
    );
  }
}
