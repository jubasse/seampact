<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/** A hook lookup that also finds the input rules the app registered for each api, for a target that runs them. */
interface InputRulesLookup
{
    /** @return iterable<mixed> every service registered as input rules of the api, in registration order */
    public function inputRules(ApiContract $contract): iterable;
}
