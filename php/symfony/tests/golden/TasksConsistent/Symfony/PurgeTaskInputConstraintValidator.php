<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Symfony\Runtime\Checks;
use Seampact\Symfony\Runtime\Format;
use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;

/**
 * The members of the input of operation 'purgeTask', as the contract declares them.
 */
final class PurgeTaskInputConstraintValidator extends InputConstraintValidator
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
      header: [
        'Idempotency-Key' => new Member(JsonType::String),
      ],
      unknownQuery: KeyPolicy::Refuse,
      body: new Member(JsonType::Object),
      bodyProofs: ['reauthToken'],
    );
  }
}
