<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\GetPreferencesResponse200;
use App\Generated\Tasks\GetPreferencesResult;
use App\Generated\Tasks\Laravel\GetPreferencesRequest;
use App\Generated\Tasks\Laravel\UpdatePreferencesRequest;
use App\Generated\Tasks\PreferencesEndpoints;
use App\Generated\Tasks\Schemas\Preferences;
use App\Generated\Tasks\UpdatePreferencesResponse200;
use App\Generated\Tasks\UpdatePreferencesResult;

final class PreferencesController implements PreferencesEndpoints
{
    private const DEFAULT_LOCALE = 'en';
    private const DEFAULT_DIGEST = false;

    public function getPreferences(GetPreferencesRequest $request): GetPreferencesResult
    {
        return new GetPreferencesResponse200(new Preferences(self::DEFAULT_LOCALE, self::DEFAULT_DIGEST));
    }

    public function updatePreferences(UpdatePreferencesRequest $request): UpdatePreferencesResult
    {
        $body = $request->contractInput()->body;

        return new UpdatePreferencesResponse200(new Preferences($body->locale ?? self::DEFAULT_LOCALE, $body->digest));
    }
}
