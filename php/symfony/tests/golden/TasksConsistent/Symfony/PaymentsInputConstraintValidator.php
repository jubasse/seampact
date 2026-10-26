<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputShape;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\JsonType;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\KeyPolicy;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Member;

/**
 * The members of the input of operation 'payments', as the contract declares them.
 */
final class PaymentsInputConstraintValidator extends InputConstraintValidator
{
  protected function shape(): InputShape
  {
    return new InputShape(
      unknownQuery: KeyPolicy::Refuse,
      body: new Member(
        JsonType::Object,
        properties: [
          'id' => new Member(JsonType::String),
          'type' => new Member(JsonType::String),
          'data' => new Member(JsonType::Any),
        ],
      ),
    );
  }
}
