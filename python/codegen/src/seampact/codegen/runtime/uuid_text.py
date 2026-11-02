"""The text of a UUID as the contract's `uuid` format takes it: 8-4-4-4-12 hexadecimal digits in either case, shared
by the access steps' type gate and the Pydantic type layer."""

import re
from typing import Final

UUID_TEXT: Final = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
