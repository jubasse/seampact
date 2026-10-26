<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * A form the PHP framework targets bring in releases of their own; each target's `FormReleases` says which release,
 * or that it generates the form already. The forms every PHP target waits for alike stay in `KeptForms`.
 */
enum PendingForm
{
    case AbsoluteUrls;
    case SignedAccess;
    case Paging;
    case PagingParam;
    case Idempotency;
    case Cache;
    case Deadline;
    case Relays;
    case Throttle;
    case RightRequirement;
    case RuleRequirement;
    case RawBody;
    case RetryHeader;
    case DerivedResponseHeader;
    case Sensitive;
    case Proofs;
    case Opaque;
    case Multipart;
    case File;
    case PageResponse;
    case ListResponse;
    case BinaryResponse;
    case RedirectResponse;
    case Union;
}
