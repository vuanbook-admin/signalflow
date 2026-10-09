"""Exclusive, scalar-only generation route decisions."""

from __future__ import annotations

import re
from typing import Any


class GenerationPolicyError(ValueError):
    pass


_SENSITIVE_KEYS = {"accesstoken", "refreshtoken", "authorization", "cookie", "cookies", "password", "secret", "token", "apikey", "privatekey", "clientsecret", "session", "sessiondata", "localstorage", "browserstorage"}
_AUTH_STORE_PATH = re.compile(r"(?:/\.hermes(?:/|$)|/\.local/share/opencode(?:/|$)|/opencode/auth\.json$)", re.IGNORECASE)
_MODES = {"subscription_package", "llm_provider"}


def _validate(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower().replace("_", "").replace("-", "") in _SENSITIVE_KEYS:
                raise GenerationPolicyError("SENSITIVE_FIELD_REJECTED")
            _validate(item)
    elif isinstance(value, list):
        for item in value:
            _validate(item)
    elif isinstance(value, str) and _AUTH_STORE_PATH.search(value):
        raise GenerationPolicyError("AUTH_FILE_PATH_REJECTED")


def resolve_generation_route(profile: dict[str, Any], required_capabilities: list[str], *, app_open: bool) -> dict[str, str | list[str]]:
    _validate(profile)
    mode = profile.get("mode")
    if mode not in _MODES:
        raise GenerationPolicyError("GENERATION_MODE_INVALID")
    capabilities = profile.get("capabilities")
    if not isinstance(capabilities, list) or not all(isinstance(item, str) for item in capabilities) or any(item not in capabilities for item in required_capabilities):
        raise GenerationPolicyError("GENERATION_CAPABILITY_MISSING")
    status = profile.get("status")
    if status != "connected":
        raise GenerationPolicyError("APP_OPEN_REQUIRED" if mode == "subscription_package" else "LLM_PROVIDER_NOT_READY")
    provider = profile.get("provider")
    model = profile.get("model")
    if not isinstance(provider, str) or not provider or not isinstance(model, str) or not model:
        raise GenerationPolicyError("GENERATION_PROFILE_INVALID")
    if mode == "subscription_package":
        if not app_open:
            raise GenerationPolicyError("APP_OPEN_REQUIRED")
        return {"route": "managed_browser", "mode": mode, "provider": provider, "model": model, "capabilities": list(required_capabilities)}
    secret_ref = profile.get("secretRef")
    if not isinstance(secret_ref, str) or not secret_ref.strip():
        raise GenerationPolicyError("LLM_PROVIDER_NOT_READY")
    return {"route": "provider_api", "mode": mode, "provider": provider, "model": model, "capabilities": list(required_capabilities)}
