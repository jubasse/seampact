<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\DeleteDraftErrors;
use App\Generated\Tasks\DeleteDraftResponse200;
use App\Generated\Tasks\DeleteDraftResult;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\GetDraftErrors;
use App\Generated\Tasks\GetDraftResponse200;
use App\Generated\Tasks\GetDraftResult;
use App\Generated\Tasks\DeleteDraftRequest;
use App\Generated\Tasks\GetDraftRequest;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class DraftsController implements DraftsEndpoints
{
    public function getDraft(GetDraftRequest $request): GetDraftResult
    {
        return ScriptedAnswers::answer(
            'getDraft',
            200,
            static fn (array $body): GetDraftResult => new GetDraftResponse200(SampleData::draft(SampleData::text($body, 'draftId'))),
            ['api.not_found' => static fn (): GetDraftResult => GetDraftErrors::apiNotFound()],
        ) ?? new GetDraftResponse200(SampleData::draft($request->contractInput()->path->draftId));
    }

    public function deleteDraft(DeleteDraftRequest $request): DeleteDraftResult
    {
        return ScriptedAnswers::answer(
            'deleteDraft',
            200,
            static fn (array $body): DeleteDraftResult => new DeleteDraftResponse200(SampleData::draft(SampleData::text($body, 'draftId'))),
            ['api.not_found' => static fn (): DeleteDraftResult => DeleteDraftErrors::apiNotFound()],
        ) ?? new DeleteDraftResponse200(SampleData::draft($request->contractInput()->path->draftId));
    }
}
