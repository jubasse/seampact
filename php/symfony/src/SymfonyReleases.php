<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\Delivery;
use Seampact\Codegen\FormArrival;
use Seampact\Codegen\FormReleases;
use Seampact\Codegen\PendingForm;

/** The release of the symfony target that brings each pending form (ADR 0024 "Refused by name or waiting" and "Delivery"). */
final class SymfonyReleases implements FormReleases
{
    public function arrivalOf(PendingForm $form): ?FormArrival
    {
        return match ($form) {
            PendingForm::Proofs, PendingForm::RightRequirement, PendingForm::RuleRequirement, PendingForm::SignedAccess,
            PendingForm::Paging, PendingForm::PagingParam, PendingForm::PageResponse, PendingForm::Idempotency, PendingForm::Cache,
            PendingForm::Deadline, PendingForm::Relays, PendingForm::Throttle, PendingForm::RawBody, PendingForm::RetryHeader,
            PendingForm::DerivedResponseHeader, PendingForm::Sensitive, PendingForm::ErrorNoStore, PendingForm::Opaque,
            PendingForm::AbsoluteUrls => null,
            PendingForm::Multipart, PendingForm::File, PendingForm::BinaryResponse, PendingForm::RedirectResponse => FormArrival::later(Delivery::Consumer),
            PendingForm::ListResponse => FormArrival::later(Delivery::AfterOneZero),
            PendingForm::Union => FormArrival::later(Delivery::ContractNeed),
        };
    }
}
