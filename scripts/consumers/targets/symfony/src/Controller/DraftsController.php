<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\DeleteDraftErrors;
use App\Generated\Tasks\DeleteDraftInput;
use App\Generated\Tasks\DeleteDraftResponse200;
use App\Generated\Tasks\DeleteDraftResult;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\GetDraftErrors;
use App\Generated\Tasks\GetDraftInput;
use App\Generated\Tasks\GetDraftResponse200;
use App\Generated\Tasks\GetDraftResult;
use App\Generated\Tasks\Symfony\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class DraftsController implements DraftsEndpoints
{
    #[SeampactOperation('getDraft')]
    public function getDraft(GetDraftInput $input): GetDraftResult
    {
        return ScriptedAnswers::answer(
            'getDraft',
            200,
            static fn (array $body): GetDraftResult => new GetDraftResponse200(SampleData::draft(SampleData::text($body, 'draftId'))),
            ['api.not_found' => static fn (): GetDraftResult => GetDraftErrors::apiNotFound()],
        ) ?? new GetDraftResponse200(SampleData::draft($input->path->draftId));
    }

    #[SeampactOperation('deleteDraft')]
    public function deleteDraft(DeleteDraftInput $input): DeleteDraftResult
    {
        return ScriptedAnswers::answer(
            'deleteDraft',
            200,
            static fn (array $body): DeleteDraftResult => new DeleteDraftResponse200(SampleData::draft(SampleData::text($body, 'draftId'))),
            ['api.not_found' => static fn (): DeleteDraftResult => DeleteDraftErrors::apiNotFound()],
        ) ?? new DeleteDraftResponse200(SampleData::draft($input->path->draftId));
    }
}
