"""Server-only credential storage. Never silently persist secrets in plaintext."""
from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any


def _system_backend() -> Any | None:
    try:
        import keyring
        backend = keyring.get_keyring()
        candidates = getattr(backend, "backends", [backend])
        for candidate in candidates:
            module = type(candidate).__module__
            if module.startswith(("keyring.backends.macOS", "keyring.backends.SecretService", "keyring.backends.libsecret", "keyring.backends.Windows")) and candidate.priority > 0:
                return candidate
    except Exception:
        pass
    return None


class CredentialVault:
    def __init__(self, data_dir: Path, *, backend: Any | None = None):
        self.service = "phynite-lab:" + hashlib.sha256(str(Path(data_dir).resolve()).encode()).hexdigest()[:24]
        self.backend = backend if backend is not None else _system_backend()
        self.memory: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()

    @property
    def persistent(self) -> bool:
        return self.backend is not None

    def read(self, name: str) -> dict[str, Any] | None:
        with self.lock:
            if name in self.memory:
                return json.loads(json.dumps(self.memory[name]))
            if self.backend is not None:
                try:
                    value = self.backend.get_password(self.service, name)
                    result = json.loads(value) if value else None
                    return result if isinstance(result, dict) else None
                except Exception:
                    return None
            return None

    def write(self, name: str, value: dict[str, Any]) -> None:
        encoded = json.dumps(value, allow_nan=False)
        with self.lock:
            if self.backend is not None:
                try:
                    self.backend.set_password(self.service, name, encoded)
                    self.memory.pop(name, None)
                    return
                except Exception:
                    # An unavailable/locked keychain must not turn into a local
                    # plaintext credential file. The UI reports session-only mode.
                    self.backend = None
            self.memory[name] = json.loads(encoded)

    def delete(self, name: str) -> None:
        with self.lock:
            if self.backend is not None:
                try:
                    # Keyring backends commonly raise when an entry is absent.
                    # An unauthenticated local gateway needs no keychain write
                    # or delete, while an unreadable entry cannot be declared
                    # disconnected safely.
                    if self.backend.get_password(self.service, name) is not None:
                        self.backend.delete_password(self.service, name)
                except Exception:
                    # A failed deletion must remain visible; otherwise a restart
                    # could unexpectedly restore a supposedly disconnected account.
                    raise RuntimeError("The credential store could not disconnect this account.") from None
            self.memory.pop(name, None)
