<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\DeleteDraftInput;
use App\Generated\Tasks\DeleteDraftResponse200;
use App\Generated\Tasks\DeleteDraftResult;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\GetDraftInput;
use App\Generated\Tasks\GetDraftResponse200;
use App\Generated\Tasks\GetDraftResult;
use App\Generated\Tasks\Symfony\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;

final class DraftsController implements DraftsEndpoints
{
    #[SeampactOperation('getDraft')]
    public function getDraft(GetDraftInput $input): GetDraftResult
    {
        return new GetDraftResponse200(SampleData::draft($input->path->draftId));
    }

    #[SeampactOperation('deleteDraft')]
    public function deleteDraft(DeleteDraftInput $input): DeleteDraftResult
    {
        return new DeleteDraftResponse200(SampleData::draft($input->path->draftId));
    }
}
