"""Keep pre-existing business-logic tests focused on functionality.

The dedicated test_security.py exercises the REAL authentication middleware.
All other offline regression tests run with a mock authenticated operator.
"""
import pytest
from fastapi.testclient import TestClient
from app import auth


@pytest.fixture(autouse=True)
def existing_tests_have_local_operator(request, monkeypatch):
    if request.node.get_closest_marker("real_auth"):
        return
    monkeypatch.setattr(auth, "authenticated_session", lambda _: ("test", "test-csrf"))
    original = TestClient.request

    def request_with_csrf(self, method, url, *args, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("X-Agro-CSRF", "test-csrf")
        return original(self, method, url, *args, headers=headers, **kwargs)

    monkeypatch.setattr(TestClient, "request", request_with_csrf)
