from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from services.customer.src.utils import email_utils

OTP_ENV_KEYS = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "SMTP_STARTTLS",
    "SMTP_MIRROR_HOST",
    "SMTP_MIRROR_PORT",
    "SMTP_MIRROR_USER",
    "SMTP_MIRROR_PASSWORD",
    "SMTP_MIRROR_FROM",
    "SMTP_MIRROR_STARTTLS",
]


class CustomerOtpEmailTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._original_env = {key: os.environ.get(key) for key in OTP_ENV_KEYS}

    def tearDown(self) -> None:
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    async def test_sends_otp_to_primary_email_and_mailpit_mirror(self) -> None:
        deliveries = []

        async def fake_send(message, **kwargs):
            deliveries.append({"message": message, "kwargs": kwargs})

        fake_aiosmtplib = SimpleNamespace(send=fake_send)

        with patch.dict(
            os.environ,
            {
                "SMTP_HOST": "smtp.gmail.com",
                "SMTP_PORT": "587",
                "SMTP_USER": "fraud.notifications@gmail.com",
                "SMTP_PASSWORD": "app-password",
                "SMTP_FROM": "fraud.notifications@gmail.com",
                "SMTP_MIRROR_HOST": "mailpit",
                "SMTP_MIRROR_PORT": "1025",
                "SMTP_MIRROR_FROM": "fraud.notifications@gmail.com",
                "SMTP_MIRROR_STARTTLS": "false",
            },
            clear=False,
        ):
            with patch.dict(sys.modules, {"aiosmtplib": fake_aiosmtplib}):
                await email_utils.send_otp_email(
                    "customer@example.com",
                    "Customer Example",
                    "123456",
                    purpose="login",
                )

        self.assertEqual(len(deliveries), 2)
        self.assertEqual(deliveries[0]["kwargs"]["hostname"], "smtp.gmail.com")
        self.assertEqual(deliveries[0]["kwargs"]["port"], 587)
        self.assertEqual(deliveries[0]["kwargs"]["start_tls"], True)
        self.assertEqual(deliveries[1]["kwargs"]["hostname"], "mailpit")
        self.assertEqual(deliveries[1]["kwargs"]["port"], 1025)
        self.assertEqual(deliveries[1]["kwargs"]["start_tls"], False)
        self.assertEqual(deliveries[0]["message"]["From"], "fraud.notifications@gmail.com")
        self.assertEqual(deliveries[1]["message"]["From"], "fraud.notifications@gmail.com")
        self.assertEqual(deliveries[0]["message"]["To"], "customer@example.com")

    async def test_deduplicates_when_primary_and_mirror_point_to_same_target(self) -> None:
        deliveries = []

        async def fake_send(message, **kwargs):
            deliveries.append({"message": message, "kwargs": kwargs})

        fake_aiosmtplib = SimpleNamespace(send=fake_send)

        with patch.dict(
            os.environ,
            {
                "SMTP_HOST": "mailpit",
                "SMTP_PORT": "1025",
                "SMTP_FROM": "fraud.notifications@gmail.com",
                "SMTP_MIRROR_HOST": "mailpit",
                "SMTP_MIRROR_PORT": "1025",
                "SMTP_MIRROR_FROM": "fraud.notifications@gmail.com",
                "SMTP_MIRROR_STARTTLS": "false",
            },
            clear=False,
        ):
            with patch.dict(sys.modules, {"aiosmtplib": fake_aiosmtplib}):
                await email_utils.send_otp_email(
                    "customer@example.com",
                    "Customer Example",
                    "654321",
                    purpose="register",
                )

        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]["kwargs"]["hostname"], "mailpit")
        self.assertEqual(deliveries[0]["kwargs"]["port"], 1025)
