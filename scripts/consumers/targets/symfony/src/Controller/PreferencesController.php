<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\GetPreferencesInput;
use App\Generated\Tasks\GetPreferencesResponse200;
use App\Generated\Tasks\GetPreferencesResult;
use App\Generated\Tasks\PreferencesEndpoints;
use App\Generated\Tasks\Schemas\Preferences;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use App\Generated\Tasks\UpdatePreferencesInput;
use App\Generated\Tasks\UpdatePreferencesResponse200;
use App\Generated\Tasks\UpdatePreferencesResult;

final class PreferencesController implements PreferencesEndpoints
{
    private const DEFAULT_LOCALE = 'en';
    private const DEFAULT_DIGEST = false;

    #[SeampactOperation('getPreferences')]
    public function getPreferences(GetPreferencesInput $input): GetPreferencesResult
    {
        return new GetPreferencesResponse200(new Preferences(self::DEFAULT_LOCALE, self::DEFAULT_DIGEST));
    }

    #[SeampactOperation('updatePreferences')]
    public function updatePreferences(UpdatePreferencesInput $input): UpdatePreferencesResult
    {
        $body = $input->body;

        return new UpdatePreferencesResponse200(new Preferences($body->locale ?? self::DEFAULT_LOCALE, $body->digest));
    }
}
