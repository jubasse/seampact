<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputShape;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\JsonType;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\KeyPolicy;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Member;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Presence;

/**
 * The members of the input of operation 'getPreferences', as the contract declares them.
 */
final class GetPreferencesInputConstraintValidator extends InputConstraintValidator
{
  protected function shape(): InputShape
  {
    return new InputShape(
      header: [
        'If-None-Match' => new Member(
          JsonType::String,
          presence: Presence::Optional,
        ),
      ],
      unknownQuery: KeyPolicy::Refuse,
    );
  }
}
