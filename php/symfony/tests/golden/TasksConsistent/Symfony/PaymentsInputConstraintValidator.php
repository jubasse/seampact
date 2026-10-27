<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;

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
