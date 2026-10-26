<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\Delivery;
use Seampact\Codegen\FormArrival;
use Seampact\Codegen\FormReleases;
use Seampact\Codegen\PendingForm;

/** The release of the laravel target that brings each pending form (ADR 0023 "Refused by name or waiting" and "Delivery"). */
final class LaravelReleases implements FormReleases
{
    public const LARAVEL_2 = 'laravel-2';
    public const LARAVEL_3 = 'laravel-3';
    public const LARAVEL_4 = 'laravel-4';

    public function arrivalOf(PendingForm $form): FormArrival
    {
        return match ($form) {
            PendingForm::Proofs => FormArrival::inRelease(self::LARAVEL_2),
            PendingForm::AbsoluteUrls, PendingForm::SignedAccess, PendingForm::Paging, PendingForm::PagingParam,
            PendingForm::PageResponse, PendingForm::Idempotency, PendingForm::Cache, PendingForm::Deadline,
            PendingForm::Relays, PendingForm::Throttle, PendingForm::RawBody, PendingForm::RetryHeader,
            PendingForm::DerivedResponseHeader, PendingForm::Sensitive, PendingForm::Opaque => FormArrival::inRelease(self::LARAVEL_3),
            PendingForm::Multipart, PendingForm::File, PendingForm::BinaryResponse, PendingForm::RedirectResponse => FormArrival::inRelease(self::LARAVEL_4),
            PendingForm::ListResponse => FormArrival::later(Delivery::AfterOneZero),
            PendingForm::Union => FormArrival::later(Delivery::ContractNeed),
        };
    }
}
