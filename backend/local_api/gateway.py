"""User-managed AI gateway. Capability evidence is produced here, never in UI."""
from __future__ import annotations

import datetime
import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, Request, build_opener

from .cloud_client import CloudError, NoRedirect
from .tls import verified_ssl_context
from .vault import CredentialVault


def gateway_url(value: str) -> str:
    parsed = urlsplit(value)
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/", "/v1", "/v1/"} or not parsed.hostname or not (parsed.scheme == "https" or parsed.scheme == "http" and local):
        raise ValueError("Gateway must use HTTPS or a loopback HTTP origin, optionally ending in /v1.")
    try:
        parsed.port
    except ValueError:
        raise ValueError("Gateway port is invalid.") from None
    return f"{parsed.scheme}://{parsed.netloc}"


class GatewayRegistry:
    def __init__(self, data_dir: Path, vault: CredentialVault, *, opener: Any | None = None):
        self.root = Path(data_dir).resolve() / "ai"
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / "gateway.json"
        self.vault = vault
        self.opener = opener or build_opener(NoRedirect(), HTTPSHandler(context=verified_ssl_context()))
        self.lock = threading.RLock()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        value = json.loads(self.path.read_text())
        gateway_url(value["baseUrl"])
        return value

    def _write(self, value: dict[str, Any]) -> None:
        temporary = self.root / (".gateway-" + secrets.token_hex(16))
        try:
            with temporary.open("x") as handle:
                json.dump(value, handle, allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            temporary.chmod(0o600)
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def status(self) -> dict[str, Any]:
        with self.lock:
            config = self._read()
            credential = self.vault.read("ai:gateway")
            return {"configured": bool(config), "baseUrl": config.get("baseUrl"), "hasCredential": bool(credential and credential.get("token")), "credentialStorage": "os-keychain" if self.vault.persistent else "session-only", "models": config.get("models", []), "capabilities": config.get("capabilities", {"models": {}}), "protocol": "anthropic-messages", "connectors": self.official_connectors()}

    @staticmethod
    def official_connectors() -> list[dict[str, Any]]:
        return [
            {"id": "codex", "label": "Codex / ChatGPT", "available": False, "reason": "A registered and approved application connection is required. Configure your own gateway until this app has access.", "documentationUrl": "https://developers.openai.com/siwc/quickstart"},
            {"id": "claude", "label": "Claude", "available": False, "reason": "Direct subscription login requires provider approval. Phynite does not import Claude session tokens.", "documentationUrl": "https://platform.claude.com/docs/en/agent-sdk/overview"},
            {"id": "antigravity", "label": "Antigravity", "available": False, "reason": "A supported application authentication contract has not been configured. Phynite does not import Antigravity session tokens."},
        ]

    def configure(self, base_url: str, token: str | None = None) -> dict[str, Any]:
        base = gateway_url(base_url)
        if token is not None and (not isinstance(token, str) or len(token) > 8192 or any(character in token for character in "\r\n\x00")):
            raise ValueError("Gateway credential is invalid.")
        with self.lock:
            previous = self._read()
            if token is None and previous.get("baseUrl") != base:
                token = ""
            if token is not None:
                if token:
                    self.vault.write("ai:gateway", {"token": token})
                else:
                    self.vault.delete("ai:gateway")
            # Changing origin/credential invalidates prior capability evidence.
            config = previous if previous.get("baseUrl") == base and token is None else {"baseUrl": base, "models": [], "capabilities": {"models": {}}}
            self._write(config)
            return self.status()

    def disconnect(self) -> None:
        with self.lock:
            self.vault.delete("ai:gateway")
            self.path.unlink(missing_ok=True)

    def _headers(self) -> dict[str, str]:
        credential = self.vault.read("ai:gateway") or {}
        token = credential.get("token", "")
        return {"Content-Type": "application/json", "anthropic-version": "2023-06-01", **({"Authorization": f"Bearer {token}"} if token else {})}

    def _open(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        config = self._read()
        if not config:
            raise CloudError(503, "AI_GATEWAY_NOT_CONFIGURED", "Configure an AI gateway before starting a conversation.")
        try:
            return self.opener.open(Request(config["baseUrl"] + path, data=json.dumps(payload, allow_nan=False).encode() if payload is not None else None, headers=self._headers(), method="POST" if payload is not None else "GET"), timeout=30)
        except HTTPError as exc:
            raise CloudError(exc.code, "AI_GATEWAY_AUTH_FAILED" if exc.code in {401, 403} else "AI_GATEWAY_UNAVAILABLE", "The gateway rejected its credential." if exc.code in {401, 403} else "The gateway request could not complete.") from None
        except OSError:
            raise CloudError(503, "AI_GATEWAY_UNAVAILABLE", "The configured gateway is unavailable. No other provider was contacted.") from None

    def discover(self) -> dict[str, Any]:
        with self.lock, self._open("/v1/models") as reply:
            raw = reply.read(2_000_001)
            if len(raw) > 2_000_000:
                raise CloudError(502, "AI_CATALOG_INVALID", "The gateway model catalogue is too large.")
            try:
                data = json.loads(raw)["data"]
                if not isinstance(data, list):
                    raise ValueError()
                models = sorted({entry["id"] for entry in data if isinstance(entry, dict) and isinstance(entry.get("id"), str) and 0 < len(entry["id"]) <= 200 and not any(ord(character) < 32 or ord(character) == 127 for character in entry["id"])})
            except (ValueError, KeyError, TypeError):
                raise CloudError(502, "AI_CATALOG_INVALID", "The gateway returned an invalid model catalogue.") from None
            if not models or len(models) > 1000:
                raise CloudError(502, "AI_CATALOG_INVALID", "The gateway catalogue must contain 1–1000 models.")
            config = self._read()
            config["models"] = models
            config["capabilities"] = {"models": {}}
            self._write(config)
            return self.status()

    @staticmethod
    def _events(reply: Any, maximum: int = 2_000_000) -> Iterator[dict[str, Any]]:
        size, lines = 0, []
        while raw := reply.readline(maximum + 1):
            size += len(raw)
            if size > maximum:
                raise CloudError(502, "AI_STREAM_INVALID", "Gateway stream exceeds its allowed size.")
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError:
                raise CloudError(502, "AI_STREAM_INVALID", "Gateway returned invalid UTF-8.") from None
            if line.startswith("data:"):
                lines.append(line[5:].lstrip())
            elif not line and lines:
                content = "\n".join(lines)
                lines = []
                try:
                    event = json.loads(content, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                except ValueError:
                    raise CloudError(502, "AI_STREAM_INVALID", "Gateway returned an invalid event.") from None
                if not isinstance(event, dict) or event.get("type") == "error":
                    raise CloudError(502, "AI_STREAM_INVALID", "Gateway stream reported a failure.")
                yield event
        if lines:
            raise CloudError(502, "AI_STREAM_INVALID", "Gateway stream ended inside an event.")

    @classmethod
    def _response(cls, reply: Any) -> tuple[list[dict[str, Any]], str]:
        """Validate the complete Anthropic contract consumed by streamClaude.

        Synthetic nonce text alone is insufficient evidence: real application
        turns require complete content blocks and a terminal stop reason before
        any parsed tool arguments may run.
        """
        started, stopped, reason = False, False, ""
        blocks: dict[int, dict[str, Any]] = {}
        try:
            for event in cls._events(reply):
                kind = event.get("type")
                if stopped:
                    raise ValueError()
                if kind == "ping":
                    continue
                if kind == "message_start":
                    if started or not isinstance(event.get("message"), dict):
                        raise ValueError()
                    started = True
                    continue
                if not started:
                    raise ValueError()
                if kind == "message_delta":
                    if reason or any(not item["closed"] for item in blocks.values()):
                        raise ValueError()
                    reason = event.get("delta", {}).get("stop_reason")
                    if reason not in {"end_turn", "tool_use", "stop_sequence", "max_tokens"}:
                        raise ValueError()
                    continue
                if kind == "message_stop":
                    if not reason or not blocks or any(not item["closed"] for item in blocks.values()):
                        raise ValueError()
                    stopped = True
                    continue
                if reason:
                    raise ValueError()
                index = event.get("index")
                if type(index) is not int or index < 0:
                    raise ValueError()
                if kind == "content_block_start":
                    block = event.get("content_block")
                    if index in blocks or not isinstance(block, dict) or block.get("type") not in {"text", "tool_use", "thinking", "redacted_thinking"}:
                        raise ValueError()
                    if block["type"] == "text" and not isinstance(block.get("text"), str):
                        raise ValueError()
                    if block["type"] == "tool_use" and (not isinstance(block.get("id"), str) or not block["id"] or not isinstance(block.get("name"), str) or not block["name"] or not isinstance(block.get("input"), dict)):
                        raise ValueError()
                    blocks[index] = {"block": dict(block), "json": "", "closed": False}
                    continue
                current = blocks.get(index)
                if not current or current["closed"]:
                    raise ValueError()
                if kind == "content_block_delta":
                    delta = event.get("delta")
                    if not isinstance(delta, dict):
                        raise ValueError()
                    field = {("text", "text_delta"): "text", ("tool_use", "input_json_delta"): "partial_json", ("thinking", "thinking_delta"): "thinking", ("thinking", "signature_delta"): "signature"}.get((current["block"]["type"], delta.get("type")))
                    if field is None or not isinstance(delta.get(field), str):
                        raise ValueError()
                    if field == "partial_json":
                        current["json"] += delta[field]
                    else:
                        current["block"][field] = current["block"].get(field, "") + delta[field]
                elif kind == "content_block_stop":
                    current["closed"] = True
                    if current["block"]["type"] == "tool_use":
                        arguments = json.loads(current["json"], parse_constant=lambda _: (_ for _ in ()).throw(ValueError())) if current["json"] else current["block"]["input"]
                        if not isinstance(arguments, dict):
                            raise ValueError()
                        current["block"]["input"] = arguments
                else:
                    raise ValueError()
        except (ValueError, TypeError, AttributeError, KeyError):
            raise CloudError(502, "AI_STREAM_INVALID", "Gateway returned an incomplete or invalid Anthropic stream. No tool capability was verified.") from None
        except OSError:
            raise CloudError(503, "AI_GATEWAY_UNAVAILABLE", "The gateway compatibility stream was interrupted. No tool capability was verified.") from None
        content = [item["block"] for item in blocks.values() if item["block"]["type"] in {"text", "tool_use"}]
        if not stopped or not content or reason == "max_tokens" and any(block["type"] == "tool_use" for block in content):
            raise CloudError(502, "AI_STREAM_INVALID", "Gateway returned an incomplete response or truncated tool arguments. No tool capability was verified.")
        return content, reason

    def probe(self, model_id: str) -> dict[str, Any]:
        with self.lock:
            config = self._read()
            if model_id not in config.get("models", []):
                raise ValueError("Choose an exact model ID from the gateway catalogue.")
            report = config.get("capabilities", {"models": {}})
            report["models"][model_id] = {"available": False, "text": False, "streaming": False, "tools": False, "images": False, "pdf": False, "efforts": ["auto"]}
            report["checkedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            config["capabilities"] = report
            # Persist invalidation before contacting the gateway. Auth/network
            # failure or process interruption must never retain a stale grant.
            self._write(config)
            nonce = secrets.token_hex(12)
            with self._open("/v1/messages", {"model": model_id, "max_tokens": 128, "stream": True, "messages": [{"role": "user", "content": f"Reply with exactly this text and nothing else: {nonce}"}]}) as reply:
                content, text_reason = self._response(reply)
            good_text = "".join(block["text"] for block in content if block["type"] == "text").strip() == nonce and not any(block["type"] == "tool_use" for block in content)
            with self._open("/v1/messages", {"model": model_id, "max_tokens": 256, "stream": True, "messages": [{"role": "user", "content": f"Call phynite_probe with nonce {nonce}."}], "tools": [{"name": "phynite_probe", "description": "Return the supplied synthetic probe nonce.", "input_schema": {"type": "object", "properties": {"nonce": {"type": "string"}}, "required": ["nonce"], "additionalProperties": False}}], "tool_choice": {"type": "tool", "name": "phynite_probe"}}) as reply:
                content, tool_reason = self._response(reply)
            calls = [block for block in content if block["type"] == "tool_use"]
            good_tool = len(calls) == 1 and calls[0]["name"] == "phynite_probe" and calls[0]["input"] == {"nonce": nonce} and tool_reason == "tool_use"
            capability = {"available": good_text and good_tool, "text": good_text, "streaming": bool(text_reason and tool_reason), "tools": good_tool, "images": False, "pdf": False, "efforts": ["auto"]}
            report["models"][model_id] = capability
            report["checkedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            config["capabilities"] = report
            self._write(config)
            return self.status()

    def environment(self) -> dict[str, str]:
        with self.lock:
            config = self._read()
            if not config:
                return {}
            credential = self.vault.read("ai:gateway") or {}
            report = config.get("capabilities", {})
            return {"PHYNITE_AI_9ROUTER_BASE_URL": config["baseUrl"], "PHYNITE_AI_9ROUTER_AUTH_TOKEN": credential.get("token", ""), "PHYNITE_AI_9ROUTER_MODELS": json.dumps(config.get("models", [])), **({"PHYNITE_AI_9ROUTER_CAPABILITIES": json.dumps(report)} if report.get("checkedAt") else {}), "PHYNITE_AI_ALLOW_LOOPBACK_PROVIDER": "true" if urlsplit(config["baseUrl"]).scheme == "http" else "false"}
