<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** The roles of a name (ADR 0007 section 1); the value is the role as written in the IR and in the vectors. */
enum NamingRole: string
{
    case Schema = 'schema';
    case Input = 'input';
    case Output = 'output';
    case Query = 'query';
    case Headers = 'headers';
    case Path = 'path';
    case Response = 'response';
    case Params = 'params';
    case Error = 'error';
    case Errors = 'errors';
    case Property = 'property';
    case Item = 'item';
    case Value = 'value';
    case Variant = 'variant';
    case Endpoints = 'endpoints';
    case Operation = 'operation';
    case Member = 'member';
    case EnumMember = 'enumMember';

    /** Whether the identifier is a type, so that the shadowed type names apply to it. */
    public function isType(): bool
    {
        return match ($this) {
            self::Operation, self::Member, self::EnumMember => false,
            default => true,
        };
    }

    /** The default word appended after the segments, null for none. */
    public function suffixWord(): ?string
    {
        return match ($this) {
            self::Input, self::Output, self::Query, self::Headers, self::Path, self::Response, self::Params,
            self::Error, self::Errors, self::Item, self::Value, self::Endpoints => $this->value,
            default => null,
        };
    }
}
