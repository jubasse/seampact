<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\HooksEndpoints;
use App\Generated\Tasks\PaymentsInput;
use App\Generated\Tasks\PaymentsResponse204;
use App\Generated\Tasks\PaymentsResult;
use App\Generated\Tasks\Symfony\SeampactOperation;

final class HooksController implements HooksEndpoints
{
    #[SeampactOperation('payments')]
    public function payments(PaymentsInput $input): PaymentsResult
    {
        return new PaymentsResponse204();
    }
}
