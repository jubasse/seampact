<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\HooksEndpoints;
use App\Generated\Tasks\PaymentsRequest;
use App\Generated\Tasks\PaymentsResponse204;
use App\Generated\Tasks\PaymentsResult;

final class HooksController implements HooksEndpoints
{
    public function payments(PaymentsRequest $request): PaymentsResult
    {
        return new PaymentsResponse204();
    }
}
