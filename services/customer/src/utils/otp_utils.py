from __future__ import annotations

import random
import string


def generate_otp_code() -> str:
    """Generate a 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))
