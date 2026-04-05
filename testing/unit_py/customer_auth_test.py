from __future__ import annotations

import importlib
import os
import sys
from types import ModuleType, SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch


def _install_customer_auth_import_stubs() -> None:
    if "jose" not in sys.modules:
        jose_module = ModuleType("jose")

        class DummyJWTError(Exception):
            pass

        jose_module.JWTError = DummyJWTError
        jose_module.jwt = SimpleNamespace(
            encode=lambda *_args, **_kwargs: "encoded-token",
            decode=lambda *_args, **_kwargs: {"sub": "customer-1"},
        )
        sys.modules["jose"] = jose_module

    if "passlib" not in sys.modules:
        sys.modules["passlib"] = ModuleType("passlib")

    if "passlib.context" not in sys.modules:
        passlib_context_module = ModuleType("passlib.context")

        class DummyCryptContext:
            def __init__(self, *_args, **_kwargs):
                pass

            def hash(self, plain):
                return f"hashed::{plain}"

            def verify(self, plain, hashed):
                return hashed == f"hashed::{plain}"

        passlib_context_module.CryptContext = DummyCryptContext
        sys.modules["passlib.context"] = passlib_context_module

    if "passlib.exc" not in sys.modules:
        passlib_exc_module = ModuleType("passlib.exc")

        class DummyUnknownHashError(Exception):
            pass

        passlib_exc_module.UnknownHashError = DummyUnknownHashError
        sys.modules["passlib.exc"] = passlib_exc_module

    if "ftds" not in sys.modules:
        sys.modules["ftds"] = ModuleType("ftds")

    if "ftds.notifications" not in sys.modules:
        notifications_module = ModuleType("ftds.notifications")
        notifications_module.send_transfer_notification = lambda *_args, **_kwargs: None
        sys.modules["ftds.notifications"] = notifications_module


_install_customer_auth_import_stubs()

auth = importlib.import_module("services.customer.auth")


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
                await auth.send_otp_email(
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
                await auth.send_otp_email(
                    "customer@example.com",
                    "Customer Example",
                    "654321",
                    purpose="register",
                )

        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]["kwargs"]["hostname"], "mailpit")
        self.assertEqual(deliveries[0]["kwargs"]["port"], 1025)
