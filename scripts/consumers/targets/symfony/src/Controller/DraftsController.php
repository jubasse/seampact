<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\GetDraftResponse200;
use App\Generated\Tasks\GetDraftResult;
use App\Generated\Tasks\GetDraftInput;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use App\Suite\SampleData;

final class DraftsController implements DraftsEndpoints
{
    #[SeampactOperation('getDraft')]
    public function getDraft(GetDraftInput $input): GetDraftResult
    {
        return new GetDraftResponse200(SampleData::draft($input->path->draftId));
    }
}
