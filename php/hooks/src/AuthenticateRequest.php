<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** What the authenticate hook of one identity receives; the generated request class narrows each member. */
interface AuthenticateRequest
{
    /** The identity name. */
    public function identity(): string;

    /** The credentials found in the locations the identity's schemes declare for this request. */
    public function credentials(): object;

    /** The CSRF companion value, on a write authenticated by a cookie scheme that declares `csrf`. */
    public function csrfToken(): ?string;

    /** Present for a signed identity. */
    public function signature(): ?SignedRequest;

    /** A read-only view of the request. */
    public function request(): RequestView;

    /** The operation the hook is called for. */
    public function operation(): OperationRef;

    /** The operation's extension values. */
    public function extensions(): object;
}
