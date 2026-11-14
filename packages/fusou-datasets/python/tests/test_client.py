"""Tests for interactive device verification in notebook environments."""

import builtins
import io
import sys
from types import ModuleType, SimpleNamespace

import fusou_datasets._client as client


def test_device_verification_accepts_jupyter_input(monkeypatch):
    monkeypatch.setitem(sys.modules, "ipykernel", ModuleType("ipykernel"))
    monkeypatch.setattr(sys, "stdin", io.StringIO())
    monkeypatch.setattr(builtins, "input", lambda prompt: "123456")
    monkeypatch.setattr(
        client,
        "_request",
        lambda *args, **kwargs: SimpleNamespace(status_code=200),
    )

    assert client._verify_device_code()
