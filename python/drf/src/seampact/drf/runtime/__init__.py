"""The DRF runtime of generated code: the base of the contract views and serializers, the typed field that keeps a
value the type layer converted, the value-rule validators, the contract exception handler, and the base of a generated
dataclass whose repr hides its sensitive members. What a later release
of seampact-drf brings is refused by name when a contract view runs, never served half done."""

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.drf.runtime.exception_handler import ExceptionHandler, contract_exception_reply
from seampact.drf.runtime.serializers import ContractSerializer, ContractTextField, SerializerFields, TypedValueField
from seampact.drf.runtime.validators import bounds, length, multiple_of, pattern
from seampact.drf.runtime.views import Admission, ContractView
from seampact.hooks._redaction import RedactedRepr

__all__ = [
    "Admission",
    "ContractSerializer",
    "ContractTextField",
    "ContractView",
    "CredentialsType",
    "ExceptionHandler",
    "RedactedRepr",
    "SerializerFields",
    "TypedValueField",
    "bounds",
    "contract_exception_reply",
    "length",
    "multiple_of",
    "pattern",
]
