"""Opt-in Phynite cloud connection; credentials never cross the local BFF."""
from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from .tls import verified_ssl_context
from .vault import CredentialVault


class CloudError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_: Any, **__: Any) -> None:
        return None


def https_origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("Cloud service must use an HTTPS origin.")
    return value.rstrip("/")


class CloudClient:
    def __init__(self, vault: CredentialVault, api_origin: str, *, region: str, client_id: str, opener: Any | None = None):
        self.vault = vault
        self.api_origin = https_origin(api_origin)
        if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-[0-9]+", region) or not re.fullmatch(r"[A-Za-z0-9_+-]{1,128}", client_id):
            raise ValueError("Cloud identity configuration is invalid.")
        self.region, self.client_id = region, client_id
        self.opener = opener or build_opener(NoRedirect(), HTTPSHandler(context=verified_ssl_context()))
        self.account: str | None = None

    def _json(self, url: str, method: str, payload: Any = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
        body = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
        request = Request(url, data=body, headers={"Content-Type": "application/json", **(headers or {})}, method=method)
        try:
            with self.opener.open(request, timeout=30) as reply:
                raw = reply.read(5_000_001)
                if len(raw) > 5_000_000:
                    raise CloudError(502, "CLOUD_RESPONSE_TOO_LARGE", "Cloud response exceeds its allowed size.")
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError()
                return value
        except HTTPError as exc:
            try:
                data = json.loads(exc.read(16_384))
            except Exception:
                data = {}
            raise CloudError(exc.code, str(data.get("code") or "CLOUD_REQUEST_FAILED"), str(data.get("error") or "Cloud request could not be completed.")) from None
        except (OSError, ValueError):
            raise CloudError(502, "CLOUD_UNAVAILABLE", "Cloud connection is unavailable. Local work is saved.") from None

    def _identity(self, target: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._json(f"https://cognito-idp.{self.region}.amazonaws.com/", "POST", payload, {"X-Amz-Target": f"AWSCognitoIdentityProviderService.{target}", "Content-Type": "application/x-amz-json-1.1"})

    def login(self, identifier: str, password: str) -> dict[str, Any]:
        if not isinstance(identifier, str) or not 1 <= len(identifier.strip()) <= 254 or not isinstance(password, str) or not 1 <= len(password) <= 256:
            raise CloudError(400, "INVALID_CREDENTIALS", "Username or email and password are required.")
        if "@" in identifier:
            result = self._identity("InitiateAuth", {"ClientId": self.client_id, "AuthFlow": "USER_PASSWORD_AUTH", "AuthParameters": {"USERNAME": identifier.strip().lower(), "PASSWORD": password}})
        else:
            result = self._json(f"{self.api_origin}/public/auth/login", "POST", {"username": identifier.strip().lower(), "password": password})
        auth = result.get("AuthenticationResult") or {}
        if not auth.get("AccessToken") or not auth.get("RefreshToken"):
            raise CloudError(409, "CLOUD_AUTH_CHALLENGE", "Complete the account authentication requirements before connecting cloud.")
        # Identity is obtained through the authenticated API, not an unverified
        # decoded token or browser-supplied account ID.
        me = self._json(f"{self.api_origin}/v1/me", "GET", headers={"Authorization": f"Bearer {auth['AccessToken']}"})
        user = me.get("user") or {}
        account = user.get("id")
        if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", account):
            raise CloudError(502, "CLOUD_IDENTITY_INVALID", "Cloud account identity could not be verified.")
        self.vault.write(f"cloud:{self.api_origin}:{account}", {"accessToken": auth["AccessToken"], "refreshToken": auth["RefreshToken"], "expiresAt": time.time() + int(auth.get("ExpiresIn", 3600)), "user": user})
        self.account = account
        return self.status()

    def status(self) -> dict[str, Any]:
        session = self.vault.read(f"cloud:{self.api_origin}:{self.account}") if self.account else None
        return {"connected": bool(session), "accountId": self.account if session else None, "user": session.get("user") if session else None, "credentialStorage": "os-keychain" if self.vault.persistent else "session-only"}

    def _token(self, account: str) -> str:
        if self.account != account:
            raise CloudError(401, "CLOUD_ACCOUNT_CHANGED", "Reconnect the cloud account associated with this project.")
        name = f"cloud:{self.api_origin}:{account}"
        session = self.vault.read(name)
        if not session:
            raise CloudError(401, "CLOUD_LOGIN_REQUIRED", "Sign in to use cloud services. Local work remains available.")
        if float(session.get("expiresAt", 0)) < time.time() + 30:
            auth = self._identity("InitiateAuth", {"ClientId": self.client_id, "AuthFlow": "REFRESH_TOKEN_AUTH", "AuthParameters": {"REFRESH_TOKEN": session["refreshToken"]}}).get("AuthenticationResult") or {}
            if not auth.get("AccessToken"):
                raise CloudError(401, "CLOUD_LOGIN_REQUIRED", "Cloud sign-in expired. Reconnect your account.")
            session.update(accessToken=auth["AccessToken"], expiresAt=time.time() + int(auth.get("ExpiresIn", 3600)))
            self.vault.write(name, session)
        return str(session["accessToken"])

    def request(self, account: str, method: str, path: str, payload: Any = None) -> dict[str, Any]:
        if not path.startswith("/v1/") or ".." in path or "\\" in path or "#" in path:
            raise ValueError("Cloud API route is invalid.")
        return self._json(self.api_origin + path, method, payload, {"Authorization": f"Bearer {self._token(account)}"})

    def resume(self, account: str) -> dict[str, Any]:
        """Reconnect an explicitly selected saved account, never a different one."""
        if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", account):
            raise ValueError("Cloud account identity is invalid.")
        self.account = account
        try:
            user = self.request(account, "GET", "/v1/me").get("user") or {}
            if user.get("id") != account:
                raise CloudError(401, "CLOUD_ACCOUNT_CHANGED", "The saved cloud identity does not match this account.")
        except BaseException:
            self.account = None
            raise
        return self.status()

    def logout(self) -> dict[str, Any]:
        revoked = True
        account = self.account
        if account:
            name = f"cloud:{self.api_origin}:{account}"
            session = self.vault.read(name)
            if session:
                try:
                    self._identity("GlobalSignOut", {"AccessToken": self._token(account)})
                except CloudError:
                    revoked = False
                finally:
                    # Local sign-out always pauses background work immediately,
                    # even when remote revocation cannot be confirmed offline.
                    self.account = None
                    self.vault.delete(name)
        self.account = None
        return {"connected": False, "remoteRevocationConfirmed": revoked}

    def _transfer_url(self, value: str) -> str:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment or not (host.endswith(".amazonaws.com") or host.endswith(".amazonaws.com.cn")):
            raise CloudError(502, "CLOUD_TRANSFER_URL_INVALID", "Cloud supplied an unsupported artifact destination.")
        return value

    def put_chunk(self, upload: dict[str, Any], data: bytes) -> None:
        if len(data) != upload["sizeBytes"]:
            raise CloudError(409, "SYNC_LOCAL_INTEGRITY", "Local transfer chunk changed. Prepare a new snapshot.")
        try:
            with self.opener.open(Request(self._transfer_url(upload["url"]), data=data, headers=upload["headers"], method="PUT"), timeout=60) as reply:
                if reply.status not in {200, 201, 204}:
                    raise CloudError(502, "CLOUD_UPLOAD_FAILED", "Cloud transfer did not complete.")
        except OSError:
            raise CloudError(502, "CLOUD_UPLOAD_FAILED", "Cloud transfer was interrupted. It can be resumed.") from None

    def download_chunk(self, url: str, maximum: int) -> bytes:
        try:
            with self.opener.open(Request(self._transfer_url(url), method="GET"), timeout=60) as reply:
                data = reply.read(maximum + 1)
                if len(data) > maximum:
                    raise CloudError(502, "SYNC_REMOTE_INTEGRITY", "Cloud chunk exceeds its declared size.")
                return data
        except OSError:
            raise CloudError(502, "CLOUD_DOWNLOAD_FAILED", "Cloud download was interrupted. Local files were retained.") from None

    def artifact_chunk(self, account: str, calculation_id: str, path: str, offset: int) -> tuple[bytes, int, int]:
        """Use the existing metered cloud artifact boundary, never direct storage."""
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", calculation_id) or type(offset) is not int or offset < 0:
            raise ValueError("Calculation transfer identity is invalid.")
        route = f"/v1/compute/cloud-artifacts/CALCULATION/{calculation_id}?" + urlencode({"path": path, "offset": str(offset)})
        try:
            with self.opener.open(Request(self.api_origin + route, headers={"Authorization": f"Bearer {self._token(account)}"}, method="GET"), timeout=60) as reply:
                data = reply.read(4 * 1024**2 + 1)
                start, next_offset, total = (int(reply.headers[name]) for name in ("X-Cloud-Artifact-Offset", "X-Cloud-Artifact-Next", "X-Cloud-Artifact-Size"))
                if start != offset or next_offset != offset + len(data) or total < next_offset or len(data) > 4 * 1024**2:
                    raise ValueError()
                return data, next_offset, total
        except HTTPError as exc:
            raise CloudError(exc.code, "CLOUD_ARTIFACT_UNAVAILABLE", "Cloud artifact transfer could not complete. Check job retention and transfer allowance.") from None
        except (OSError, ValueError, KeyError):
            raise CloudError(502, "CLOUD_ARTIFACT_INTEGRITY", "Cloud artifact transfer was interrupted or returned invalid bounds.") from None
