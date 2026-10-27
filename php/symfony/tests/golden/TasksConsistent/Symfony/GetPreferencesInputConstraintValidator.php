<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Codegen\Runtime\Presence;
use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;

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
