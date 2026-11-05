"""Server-side Materials Project credentials and fixed-origin catalogue transport.

Secrets stay in the shared OS credential vault, or in process memory when that
vault is unavailable. Neither the browser API nor project archives contain keys.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from typing import Any

from backend.local_api.domain.phynite_core import ApiError, query_filter, utc_now
from .tls import verified_ssl_context
from .vault import CredentialVault

MAXIMUM_RESPONSE_BYTES = 16 * 1024 ** 2
SUMMARY_FIELDS = "material_id,formula_pretty,structure,symmetry,nsites,band_gap,energy_above_hull,is_stable,density,ordering,theoretical,last_updated"
KEY_NAME = "materials-project"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # The API key is authorized for this one origin. Never forward it to a
        # redirect destination, including when the remote API changes hosts.
        return None


class MaterialsProjectConnection:
    def __init__(self, vault: CredentialVault, *, environment: Mapping[str, str] | None = None, opener=None):
        self.vault = vault
        self.environment = os.environ if environment is None else environment
        self.opener = opener
        self.lock = threading.RLock()
        self.verified_key: str | None = None
        self.checked_at: str | None = None

    def _effective(self) -> tuple[str, str | None]:
        try:
            saved = self.vault.read(KEY_NAME, strict=True)
        except RuntimeError:
            raise ApiError(503, "The credential store is locked or unavailable. Unlock it and retry.", "MP_CREDENTIAL_UNAVAILABLE") from None
        if isinstance(saved, dict) and isinstance(saved.get("apiKey"), str) and saved["apiKey"]:
            return saved["apiKey"], "settings"
        inherited = self.environment.get("MP_API_KEY", "").strip()
        return (inherited, "environment") if inherited else ("", None)

    @staticmethod
    def _fingerprint(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    def status(self) -> dict[str, Any]:
        with self.lock:
            key, source = self._effective()
            verified = bool(key and self.verified_key == self._fingerprint(key))
            storage = ("os-keychain" if self.vault.persistent else "session-only") if source == "settings" else source or "none"
            return {"configured": bool(key), "source": source, "credentialStorage": storage,
                    "persistent": bool(source == "environment" or source == "settings" and self.vault.persistent),
                    "verified": verified, "checkedAt": self.checked_at if verified else None}

    def api_key(self) -> str:
        with self.lock:
            key, _ = self._effective()
        if not key:
            raise ApiError(503, "Add your Materials Project API key in Settings → Compute.", "MP_API_KEY_MISSING")
        return key

    def save(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = payload.get("apiKey") if isinstance(payload, dict) else None
        if (not isinstance(payload, dict) or set(payload) != {"apiKey"} or not isinstance(key, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", key.strip())):
            raise ApiError(400, "Enter a valid Materials Project API key without spaces.", "MP_API_KEY_INVALID")
        with self.lock:
            try:
                self.vault.write(KEY_NAME, {"apiKey": key.strip()}, allow_session_fallback=False)
            except RuntimeError:
                raise ApiError(503, "The credential store could not save this API key. Unlock it and retry.", "MP_CREDENTIAL_SAVE_FAILED") from None
            self.verified_key = self.checked_at = None
            return self.status()

    def remove(self) -> dict[str, Any]:
        with self.lock:
            try:
                self.vault.delete(KEY_NAME)
            except RuntimeError:
                raise ApiError(503, "The credential store could not remove this API key. Unlock the credential store and retry.", "MP_CREDENTIAL_DELETE_FAILED") from None
            self.verified_key = self.checked_at = None
            return self.status()

    def _request(self, query: str, limit: int, options: dict[str, Any] | None = None) -> dict[str, Any]:
        if (not isinstance(query, str) or not 1 <= len(query.strip()) <= 80
                or not re.fullmatch(r"[A-Za-z0-9*+\-., ()]+", query.strip())
                or re.search(r"api[_ -]?key|password|bearer|token|sk-[\w-]{12,}", query, re.I)):
            raise ApiError(400, "Use a public formula, element list, chemical system, or MP-ID without credentials.", "INVALID_MATERIAL_QUERY")
        if type(limit) is not int or not 1 <= limit <= 30:
            raise ApiError(400, "Choose between one and thirty material records.", "INVALID_MATERIAL_LIMIT")
        options = options or {}
        property_names = {"spaceGroup": "spacegroup_number", "minSites": "nsites_min", "maxSites": "nsites_max", "minBandGap": "band_gap_min", "maxBandGap": "band_gap_max", "maxEnergyAboveHull": "energy_above_hull_max"}
        sorts = {"default": "energy_above_hull", "energy-above-hull": "energy_above_hull", "sites": "nsites", "-sites": "-nsites", "band-gap": "band_gap", "-band-gap": "-band_gap"}
        if set(options) - {*property_names, "offset", "sort"} or options.get("sort", "default") not in sorts:
            raise ApiError(400, "Choose supported Materials Project filters and sorting.", "CRYSTAL_FILTER_INVALID")
        try:
            offset = int(options.get("offset", 0))
            if str(offset) != str(options.get("offset", 0)) or not 0 <= offset <= 10_000:
                raise ValueError()
            filters = {name: float(value) for name, value in options.items() if name in property_names}
            for name, value in filters.items():
                if not math.isfinite(value) or abs(value) > 100_000 or name in {"spaceGroup", "minSites", "maxSites"} and (value < 1 or not value.is_integer()) or name == "spaceGroup" and value > 230:
                    raise ValueError()
            if filters.get("minSites", 0) > filters.get("maxSites", math.inf) or filters.get("minBandGap", 0) > filters.get("maxBandGap", math.inf):
                raise ValueError()
        except (ValueError, TypeError):
            raise ApiError(400, "Use valid property ranges, site counts and page offsets.", "CRYSTAL_FILTER_INVALID") from None
        key = self.api_key()
        filter_key, filter_value = query_filter(query.strip())
        parameters = {filter_key: filter_value, "_fields": SUMMARY_FIELDS, "_limit": str(limit), "_sort_fields": sorts[options.get("sort", "default")]}
        if offset:
            parameters["_skip"] = str(offset)
        parameters.update({property_names[name]: str(int(value)) if value.is_integer() else str(value) for name, value in filters.items()})
        params = urllib.parse.urlencode(parameters)
        request = urllib.request.Request("https://api.materialsproject.org/materials/summary/?" + params,
                                         headers={"X-API-KEY": key, "Accept": "application/json", "User-Agent": "phynite-lab/1.0"})
        try:
            opener = self.opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=verified_ssl_context()), _NoRedirect()).open
            with opener(request, timeout=15) as upstream:
                raw = upstream.read(MAXIMUM_RESPONSE_BYTES + 1)
            if len(raw) > MAXIMUM_RESPONSE_BYTES:
                raise ApiError(502, "Materials Project returned too much data. Narrow the search or import a CIF manually.", "MP_RESPONSE_TOO_LARGE")
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list) or any(not isinstance(item, dict) for item in payload["data"]):
                raise ValueError()
        except urllib.error.HTTPError as error:
            # Close without reading or printing upstream reason/body: those may
            # contain reflected request data and must not leak via GC warnings.
            error.close()
            if error.code in {401, 403}:
                with self.lock:
                    if self.verified_key == self._fingerprint(key):
                        self.verified_key = self.checked_at = None
                raise ApiError(503, "Materials Project rejected this API key. Replace it in Settings → Compute.", "MP_API_ERROR") from None
            if error.code == 429:
                raise ApiError(429, "Materials Project's request limit was reached. Wait before retrying.", "MP_RATE_LIMITED") from None
            raise ApiError(502, "Materials Project could not complete this request. Try again later.", "MP_API_ERROR") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ApiError(502, "Materials Project is temporarily unreachable. Check the internet connection and retry.", "MP_NETWORK_ERROR") from None
        except (UnicodeDecodeError, ValueError):
            raise ApiError(502, "Materials Project returned an unreadable response. Try again later.", "MP_RESPONSE_INVALID") from None
        with self.lock:
            if self._effective()[0] == key:
                self.verified_key, self.checked_at = self._fingerprint(key), utc_now()
        # Only catalogue documents are returned. HTTP headers, error bodies and
        # credential-vault metadata never become browser/AI context.
        result = {"data": payload["data"][:limit]}
        total = payload.get("meta", {}).get("total_doc") if isinstance(payload.get("meta"), dict) else None
        if type(total) is int and total >= 0:
            result["meta"] = {"total_doc": total}
        return result

    def search(self, query: str, limit: int = 12, options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request(query, limit, options)

    def test(self) -> dict[str, Any]:
        # An explicit recheck supersedes an earlier success. Failed/offline
        # checks must not leave the settings screen claiming it just verified.
        with self.lock:
            self.verified_key = self.checked_at = None
        self._request("mp-149", 1)
        return self.status()
