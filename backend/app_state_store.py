"""SQLite authority for scalar SignalFlow agency operations."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class StateValidationError(ValueError):
    pass


_SENSITIVE_KEYS = {
    "accesstoken", "refreshtoken", "authorization", "cookie", "cookies", "password",
    "secret", "token", "apikey", "privatekey", "clientsecret", "session", "sessiondata",
    "localstorage", "browserstorage",
}
_AUTH_STORE_PATH = re.compile(r"(?:/\.hermes(?:/|$)|/\.local/share/opencode(?:/|$)|/opencode/auth\.json$)", re.IGNORECASE)
_GENERATION_MODES = {"subscription_package", "llm_provider"}
_CONTENT_RUN_GENERATION_STATUSES = {"pending", "completed", "failed", "unknown"}
_CONTENT_RUN_TRANSFORM_MODES = {"original", "rewrite", "repurpose", "imitation", "de_ai_detector_evasion"}
_CONTENT_RUN_LINEAGE_KEYS = {"selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "selectedRecipeId", "recipeId", "transformMode", "mediaSetFingerprint", "customerFacts", "contentIntelligenceLineage"}
_CONTENT_RUN_MEDIA_METADATA_KEYS = {"mediaEvidence", "mediaAssetIds", "mediaUrl", "imageUrl", "videoUrl", "publicUrl", "mediaSha256", "visualFingerprint", "mediaProvenance", "mediaOperations", "mediaKind"}
_CONTENT_RUN_PERSISTED_KEYS = {
    "topic", "contentPillar", "contentAngle", "objective", "strategyVersion", "catalogFingerprint", "strategySnapshot", "strategyState", "regenerationState", "caption", "body", "cta", "hashtags", "seoKeywords", "scheduledAt", "sources", "notes",
    "targetPlatforms", "targetBindingIds", "bindingIds", "qualityChecks", "qualityStatus", "approvalState", "state", "trigger",
    "visualOperations", "mediaOperations", "providerTraceId", "identity", "profile", "trace", "variants", "contentKind", "mediaKind", "mediaUrl", "imageUrl", "videoUrl", "publicUrl", "mediaSha256", "visualFingerprint", "mediaAssetIds",
    "mediaProvenance", "automationKey", "targetPageId", "identityVersionId", "generationProfileId", "executionMode", "recipeId",
    "selectedRecipeId", "transformMode", "sourceRef", "researchState", "researchSourceCount", "planId", "targetApprovalState",
    "targetApprovalIntents", "requestId", "promptVersion", "prompt", "mediaSetFingerprint", "mediaRevision", "generationStatus", "mediaEvidence", "mediaReplacement",
    "selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion",
    "promptBlueprintVersion", "customerFacts", "contentIntelligenceLineage", "revisionId", "parentRevisionId", "revisionHistory", "checkedAt",
    "parentContentRunId", "revisionCreatedAt", "strategyRationale", "imageProvider", "videoProvider", "rewriteError", "rewriteStatus",
}
_CONTENT_RUN_ALLOWED_KEYS = _CONTENT_RUN_PERSISTED_KEYS | {"id", "clientId", "brandId", "checkedAt", "expectedRevisionFields"}
_CONTENT_RUN_STRATEGY_KEYS = {"contentAngle", "strategyVersion", "catalogFingerprint", "strategySnapshot", "strategyState", "regenerationState"}
_CONTENT_RUN_STRATEGY_ALIASES = {"content_angle": "contentAngle", "strategy_version": "strategyVersion", "catalog_fingerprint": "catalogFingerprint", "strategy_snapshot": "strategySnapshot", "strategy_state": "strategyState", "regeneration_state": "regenerationState"}
_CONTENT_RUN_STRATEGY_STATES = {"clean", "needs_regeneration"}
_CONTENT_RUN_STRATEGY_FORMATS = {"text", "image", "video"}
_CONTENT_RUN_STRATEGY_SNAPSHOT_KEYS = {"objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "angleIdByChannel", "channel", "format", "strategyVersion", "catalogFingerprint", "recipeId", "recipeGuidance"}
_LOCAL_MEDIA_PATH = re.compile(r"^(?:file:/{0,2}|~/|/|[A-Za-z]:[\\/]|\\\\|\.\.?[\\/])", re.IGNORECASE)
_MANAGE_BRAND_ROLES = {"owner", "admin"}
_TERMINAL_PUBLICATION_STATES = {"published", "canceled", "cancelled", "failed", "permanent_error", "approval_failed", "blocked"}
_BRAND_IMPACT_COUNT_KEYS = ("draftCount", "planCount", "unsentScheduleCount", "sharedMediaCount")
# ponytail: one process-wide lock keeps local deletion retries idempotent; use a database lease if multi-process writers are introduced.
_BRAND_DELETE_LOCK = threading.Lock()
_STRATEGY_OBJECTIVE_KEYS = ("reach", "engagement", "education", "knowledge", "conversion")
_STRATEGY_CHANNELS = {"facebook", "instagram", "tiktok", "youtube"}
_STRATEGY_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_STRATEGY_SECRET_VALUE = re.compile(r"(?:^|[^a-z])(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|token|password|cookie)(?:$|[^a-z])", re.IGNORECASE)
_STRATEGY_MAX_LABEL = 160
_STRATEGY_MAX_DESCRIPTION = 500
_STRATEGY_MAX_GUIDANCE = 500
_STRATEGY_MAX_DATE = 80
_STRATEGY_U64 = (1 << 64) - 1
_STRATEGY_FNV_PRIME = 0x100000001B3


def _parse_iso_date(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _utc_iso(value: str) -> str:
    parsed = _parse_iso_date(value)
    if parsed is None:
        raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
    if parsed.tzinfo is None:
        raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _aware_in_zone(value: str, zone: ZoneInfo) -> datetime | None:
    parsed = _parse_iso_date(value)
    if parsed is None:
        return None
    return parsed.replace(tzinfo=zone) if parsed.tzinfo is None else parsed.astimezone(zone)


def strategy_catalog_scope_key(client_id: str, brand_id: str) -> str:
    """Return the one durable catalog scope key; a Brand id alone is never sufficient."""
    if not isinstance(client_id, str) or not client_id.strip() or not isinstance(brand_id, str) or not brand_id.strip():
        raise StateValidationError("STRATEGY_CATALOG_SCOPE_INVALID")
    return json.dumps([client_id.strip(), brand_id.strip()], ensure_ascii=False, separators=(",", ":"))


def _strategy_has_only_keys(value: Any, allowed: set[str]) -> bool:
    return isinstance(value, dict) and set(value).issubset(allowed)


def _strategy_valid_text(value: Any, maximum: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and not _STRATEGY_SECRET_VALUE.search(value)


def _strategy_is_kebab(value: Any) -> bool:
    return isinstance(value, str) and bool(_STRATEGY_ID.fullmatch(value))


def _strategy_valid_channels(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(channel, str) and channel in _STRATEGY_CHANNELS for channel in value) and len(set(value)) == len(value)


def _strategy_contiguous_order(values: list[Any]) -> bool:
    orders = [item.get("order") if isinstance(item, dict) else None for item in values]
    return bool(values) and all(isinstance(order, int) and not isinstance(order, bool) for order in orders) and len(set(orders)) == len(values) and all(order == index for index, order in enumerate(orders, 1))


def _strategy_valid_angle(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    recipe_id = value.get("recipeId")
    return _strategy_has_only_keys(value, {"id", "label", "guidance", "enabled", "order", "channels", "recipeId"}) and _strategy_is_kebab(value.get("id")) and _strategy_valid_text(value.get("label"), _STRATEGY_MAX_LABEL) and _strategy_valid_text(value.get("guidance"), _STRATEGY_MAX_GUIDANCE) and isinstance(value.get("enabled"), bool) and isinstance(value.get("order"), int) and not isinstance(value.get("order"), bool) and value.get("order", 0) > 0 and _strategy_valid_channels(value.get("channels")) and (recipe_id is None or _strategy_is_kebab(recipe_id))


def _strategy_valid_pillar(value: Any) -> bool:
    if not _strategy_has_only_keys(value, {"id", "label", "description", "enabled", "order", "channels", "angles"}) or not _strategy_is_kebab(value.get("id")) or not _strategy_valid_text(value.get("label"), _STRATEGY_MAX_LABEL) or not _strategy_valid_text(value.get("description"), _STRATEGY_MAX_DESCRIPTION) or not isinstance(value.get("enabled"), bool) or not isinstance(value.get("order"), int) or isinstance(value.get("order"), bool) or value.get("order", 0) <= 0 or not _strategy_valid_channels(value.get("channels")):
        return False
    angles = value.get("angles")
    return isinstance(angles, list) and all(_strategy_valid_angle(item) for item in angles) and any(item.get("enabled") is True for item in angles)


def _strategy_collect_strings(value: Any, seen: set[int] | None = None) -> list[str]:
    seen = seen or set()
    if isinstance(value, str):
        return [value]
    if not isinstance(value, (dict, list)) or id(value) in seen:
        return []
    seen.add(id(value))
    values = value if isinstance(value, list) else value.values()
    return [item for nested in values for item in _strategy_collect_strings(nested, seen)]


def _strategy_recipe_references(catalog: dict[str, Any]) -> list[tuple[str, str]]:
    references: list[tuple[str, str]] = []
    for pillar in catalog.get("pillars", []):
        for angle in pillar.get("angles", []):
            if angle.get("recipeId") is not None:
                references.append((str(angle["id"]), str(angle["recipeId"])))
    for override in catalog.get("channelOverrides", {}).values():
        for pillar in override.get("addedPillars", []):
            for angle in pillar.get("angles", []):
                if angle.get("recipeId") is not None:
                    references.append((str(angle["id"]), str(angle["recipeId"])))
        for angles in override.get("addedAnglesByPillarId", {}).values():
            for angle in angles:
                if angle.get("recipeId") is not None:
                    references.append((str(angle["id"]), str(angle["recipeId"])))
    return references


def _validate_strategy_catalog(catalog: Any, expected_brand_id: str | None = None, *, allow_reduced_objectives: bool = False) -> None:
    if not _strategy_has_only_keys(catalog, {"brandId", "version", "objectives", "pillars", "channelOverrides", "updatedAt"}):
        raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
    if expected_brand_id is not None and catalog.get("brandId") != expected_brand_id:
        raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
    if not _strategy_is_kebab(catalog.get("brandId")) or not isinstance(catalog.get("version"), int) or isinstance(catalog.get("version"), bool) or catalog.get("version", 0) < 1 or not isinstance(catalog.get("updatedAt"), str) or len(catalog["updatedAt"]) > _STRATEGY_MAX_DATE or _parse_iso_date(catalog["updatedAt"]) is None:
        raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
    if any(_STRATEGY_SECRET_VALUE.search(value) for value in _strategy_collect_strings(catalog)):
        raise StateValidationError("STRATEGY_CATALOG_SECRET_SHAPED_VALUE")
    objectives = catalog.get("objectives")
    if isinstance(objectives, list) and any(isinstance(item, dict) and not _strategy_has_only_keys(item, {"key", "label", "description", "enabled", "order"}) for item in objectives):
        raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
    raw_pillars = catalog.get("pillars")
    if isinstance(raw_pillars, list):
        for pillar in raw_pillars:
            if isinstance(pillar, dict) and not _strategy_has_only_keys(pillar, {"id", "label", "description", "enabled", "order", "channels", "angles"}):
                raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
            for angle in pillar.get("angles", []) if isinstance(pillar, dict) and isinstance(pillar.get("angles"), list) else []:
                if isinstance(angle, dict) and not _strategy_has_only_keys(angle, {"id", "label", "guidance", "enabled", "order", "channels", "recipeId"}):
                    raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
    raw_overrides = catalog.get("channelOverrides")
    if isinstance(raw_overrides, dict):
        for override in raw_overrides.values():
            if not isinstance(override, dict):
                continue
            if not _strategy_has_only_keys(override, {"disabledObjectiveKeys", "disabledPillarIds", "disabledAngleIds", "addedPillars", "addedAnglesByPillarId", "guidanceByAngleId"}):
                raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
            for pillar in override.get("addedPillars", []) if isinstance(override.get("addedPillars"), list) else []:
                if isinstance(pillar, dict) and not _strategy_has_only_keys(pillar, {"id", "label", "description", "enabled", "order", "channels", "angles"}):
                    raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
                for angle in pillar.get("angles", []) if isinstance(pillar, dict) and isinstance(pillar.get("angles"), list) else []:
                    if isinstance(angle, dict) and not _strategy_has_only_keys(angle, {"id", "label", "guidance", "enabled", "order", "channels", "recipeId"}):
                        raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
            for angles in override.get("addedAnglesByPillarId", {}).values() if isinstance(override.get("addedAnglesByPillarId"), dict) else []:
                for angle in angles if isinstance(angles, list) else []:
                    if isinstance(angle, dict) and not _strategy_has_only_keys(angle, {"id", "label", "guidance", "enabled", "order", "channels", "recipeId"}):
                        raise StateValidationError("STRATEGY_CATALOG_SCHEMA_INVALID")
    if not isinstance(objectives, list) or not objectives:
        raise StateValidationError("STRATEGY_CATALOG_OBJECTIVES_REQUIRED")
    if any(not _strategy_has_only_keys(item, {"key", "label", "description", "enabled", "order"}) or item.get("key") not in _STRATEGY_OBJECTIVE_KEYS or not _strategy_valid_text(item.get("label"), _STRATEGY_MAX_LABEL) or not _strategy_valid_text(item.get("description"), _STRATEGY_MAX_DESCRIPTION) or not isinstance(item.get("enabled"), bool) or not isinstance(item.get("order"), int) or isinstance(item.get("order"), bool) or item.get("order", 0) <= 0 for item in objectives):
        raise StateValidationError("STRATEGY_CATALOG_OBJECTIVE_INVALID")
    if len({item["key"] for item in objectives}) != len(objectives):
        raise StateValidationError("STRATEGY_CATALOG_OBJECTIVE_DUPLICATE")
    if not _strategy_contiguous_order(objectives):
        raise StateValidationError("OBJECTIVE_ORDER_INVALID")
    if not allow_reduced_objectives and (len(objectives) != len(_STRATEGY_OBJECTIVE_KEYS) or set(item["key"] for item in objectives) != set(_STRATEGY_OBJECTIVE_KEYS)):
        raise StateValidationError("STRATEGY_CATALOG_OBJECTIVE_SET_INVALID")
    pillars = catalog.get("pillars")
    if not isinstance(pillars, list) or not pillars:
        raise StateValidationError("STRATEGY_CATALOG_PILLARS_REQUIRED")
    if any(isinstance(item, dict) and item.get("channels") is not None and not _strategy_valid_channels(item.get("channels")) for item in pillars):
        raise StateValidationError("CATALOG_CHANNEL_INVALID")
    if any(isinstance(item, dict) and isinstance(item.get("angles"), list) and any(isinstance(angle, dict) and angle.get("channels") is not None and not _strategy_valid_channels(angle.get("channels")) for angle in item["angles"]) for item in pillars):
        raise StateValidationError("CATALOG_CHANNEL_INVALID")
    if any(not _strategy_valid_pillar(item) for item in pillars):
        raise StateValidationError("STRATEGY_CATALOG_PILLAR_INVALID")
    if len({item["id"] for item in pillars}) != len(pillars):
        raise StateValidationError("STRATEGY_CATALOG_PILLAR_DUPLICATE")
    if not _strategy_contiguous_order(pillars):
        raise StateValidationError("PILLAR_ORDER_INVALID")
    angle_ids: list[str] = []
    for pillar in pillars:
        angles = pillar["angles"]
        if len({angle["id"] for angle in angles}) != len(angles):
            raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
        if not _strategy_contiguous_order(angles):
            raise StateValidationError("ANGLE_ORDER_INVALID")
        angle_ids.extend(angle["id"] for angle in angles)
    if len(set(angle_ids)) != len(angle_ids):
        raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
    overrides = catalog.get("channelOverrides")
    if not isinstance(overrides, dict):
        raise StateValidationError("STRATEGY_CATALOG_OVERRIDES_INVALID")
    known_pillars = {item["id"] for item in pillars}
    known_angles = set(angle_ids)
    all_pillar_ids = set(known_pillars)
    all_angle_ids = set(known_angles)
    seen_added_angle_ids: set[str] = set()
    for channel, override in overrides.items():
        if channel not in _STRATEGY_CHANNELS:
            raise StateValidationError("CATALOG_CHANNEL_INVALID")
        if not isinstance(override, dict):
            raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
        added_pillars = override.get("addedPillars", [])
        if not isinstance(added_pillars, list) or any(not _strategy_valid_pillar(item) for item in added_pillars):
            raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
        added_pillar_ids = [item["id"] for item in added_pillars]
        if len(set(added_pillar_ids)) != len(added_pillar_ids) or all_pillar_ids.intersection(added_pillar_ids):
            raise StateValidationError("STRATEGY_CATALOG_PILLAR_DUPLICATE")
        added_pillar_angle_ids = [angle["id"] for pillar in added_pillars for angle in pillar["angles"]]
        if len(set(added_pillar_angle_ids)) != len(added_pillar_angle_ids) or all_angle_ids.intersection(added_pillar_angle_ids):
            raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
        if added_pillars and not _strategy_contiguous_order([*pillars, *added_pillars]):
            raise StateValidationError("PILLAR_ORDER_INVALID")
        added_angles = override.get("addedAnglesByPillarId", {})
        if not isinstance(added_angles, dict):
            raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
        raw_added_angle_ids = [angle["id"] for pillar in added_pillars for angle in pillar["angles"]]
        raw_added_angle_ids.extend(angle["id"] for angles in added_angles.values() if isinstance(angles, list) and all(isinstance(angle, dict) and "id" in angle for angle in angles) for angle in angles)
        if len(set(raw_added_angle_ids)) != len(raw_added_angle_ids) or known_angles.intersection(raw_added_angle_ids) or seen_added_angle_ids.intersection(raw_added_angle_ids):
            raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
        seen_added_angle_ids.update(raw_added_angle_ids)
        added_pillar_id_set = known_pillars | set(added_pillar_ids)
        local_angle_ids = set(known_angles) | {angle["id"] for item in added_pillars for angle in item["angles"]}
        if (local_angle_ids - known_angles).intersection(all_angle_ids):
            raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
        for pillar_id, angles in added_angles.items():
            if pillar_id not in added_pillar_id_set or not isinstance(angles, list) or any(not _strategy_valid_angle(item) for item in angles):
                raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
            if len({item["id"] for item in angles}) != len(angles) or any(item["id"] in local_angle_ids for item in angles):
                raise StateValidationError("STRATEGY_CATALOG_ANGLE_DUPLICATE")
            base_angles = next((item["angles"] for item in pillars if item["id"] == pillar_id), next((item["angles"] for item in added_pillars if item["id"] == pillar_id), []))
            if not _strategy_contiguous_order([*base_angles, *angles]):
                raise StateValidationError("ANGLE_ORDER_INVALID")
            local_angle_ids.update(item["id"] for item in angles)
        for field, allowed in (("disabledObjectiveKeys", set(_STRATEGY_OBJECTIVE_KEYS)), ("disabledPillarIds", added_pillar_id_set), ("disabledAngleIds", local_angle_ids)):
            values = override.get(field)
            if values is not None and (not isinstance(values, list) or any(not isinstance(value, str) for value in values) or len(set(values)) != len(values) or any(not _strategy_is_kebab(value) for value in values) or any(value not in allowed for value in values)):
                raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
        guidance = override.get("guidanceByAngleId")
        if guidance is not None and (not isinstance(guidance, dict) or any(not _strategy_is_kebab(key) or key not in local_angle_ids or not _strategy_valid_text(value, _STRATEGY_MAX_GUIDANCE) for key, value in guidance.items())):
            raise StateValidationError("STRATEGY_CATALOG_OVERRIDE_INVALID")
        all_pillar_ids.update(added_pillar_ids)
        all_angle_ids.update(local_angle_ids)


def _strategy_stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def strategy_catalog_fingerprint(catalog: dict[str, Any]) -> str:
    data = _strategy_stable_json(catalog).encode("utf-8")
    lanes = (0xCBF29CE484222325, 0x84222325CBF29CE4, 0x9E3779B185EBCA87, 0x6A09E667F3BCC909)
    return "".join(f"{_strategy_hash64(data, seed):016x}" for seed in lanes)


def _strategy_hash64(data: bytes, seed: int) -> int:
    value = seed
    for byte in data:
        value = ((value ^ byte) * _STRATEGY_FNV_PRIME) & _STRATEGY_U64
    return value


validate_strategy_catalog = _validate_strategy_catalog


class AgencyStateStore:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self.connection = sqlite3.connect(str(path), check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self._create_schema()

    def close(self) -> None:
        self.connection.close()

    @staticmethod
    def strategy_catalog_scope_key(client_id: str, brand_id: str) -> str:
        return strategy_catalog_scope_key(client_id, brand_id)

    @staticmethod
    def strategy_catalog_fingerprint(catalog: dict[str, Any]) -> str:
        return strategy_catalog_fingerprint(catalog)

    def validate_scalar_payload(self, value: Any) -> None:
        self._validate_scalar(value)

    def _validate_scalar(self, value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                normalized = str(key).lower().replace("_", "").replace("-", "")
                if normalized in _SENSITIVE_KEYS:
                    raise StateValidationError("SENSITIVE_FIELD_REJECTED")
                self._validate_scalar(item)
        elif isinstance(value, list):
            for item in value:
                self._validate_scalar(item)
        elif isinstance(value, str) and _AUTH_STORE_PATH.search(value):
            raise StateValidationError("AUTH_FILE_PATH_REJECTED")

    @staticmethod
    def _assert_content_run_payload_keys(value: dict[str, Any]) -> None:
        unknown = set(value).difference(_CONTENT_RUN_ALLOWED_KEYS)
        if unknown:
            raise StateValidationError("CONTENT_RUN_PAYLOAD_INVALID")

    @staticmethod
    def _text(value: Any, code: str, maximum: int = 600) -> str:
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
            raise StateValidationError(code)
        return value.strip()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS clients (
              id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS brands (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), name TEXT NOT NULL, status TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE TABLE IF NOT EXISTS brand_actor_bindings (
              brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
              actor_user_id TEXT NOT NULL,
              role TEXT NOT NULL,
              capabilities_json TEXT NOT NULL DEFAULT '["manage_brand"]',
              PRIMARY KEY (brand_id, actor_user_id)
            );
            CREATE TABLE IF NOT EXISTS brand_identities (
              id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), name TEXT NOT NULL,
              is_default INTEGER NOT NULL CHECK(is_default IN (0, 1)), version INTEGER NOT NULL CHECK(version > 0), status TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_default_identity_per_brand ON brand_identities(brand_id) WHERE is_default = 1;
            CREATE TABLE IF NOT EXISTS connections (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), platform TEXT NOT NULL,
              external_account_id TEXT NOT NULL, display_name TEXT NOT NULL, connection_state TEXT NOT NULL,
              scopes_json TEXT NOT NULL, secret_ref TEXT
            );
            CREATE TABLE IF NOT EXISTS channel_bindings (
              id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), identity_id TEXT NOT NULL REFERENCES brand_identities(id),
              connection_id TEXT NOT NULL REFERENCES connections(id), target_external_id TEXT NOT NULL, target_name TEXT NOT NULL, state TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS generation_profiles (
              id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), mode TEXT NOT NULL CHECK(mode IN ('subscription_package', 'llm_provider')),
              provider TEXT NOT NULL, model TEXT NOT NULL, capabilities_json TEXT NOT NULL, status TEXT NOT NULL, secret_ref TEXT
            );
            CREATE TABLE IF NOT EXISTS content_runs (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT NOT NULL REFERENCES brands(id),
              identity_version_id TEXT NOT NULL REFERENCES brand_identities(id), generation_profile_id TEXT REFERENCES generation_profiles(id),
              execution_mode TEXT NOT NULL CHECK(execution_mode IN ('subscription_package', 'llm_provider')), provider_attempted INTEGER NOT NULL DEFAULT 0 CHECK(provider_attempted IN (0, 1)), recipe_id TEXT,
              payload_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TRIGGER IF NOT EXISTS content_run_profile_immutable
              BEFORE UPDATE OF generation_profile_id ON content_runs
              WHEN OLD.provider_attempted = 1
              BEGIN SELECT RAISE(ABORT, 'CONTENT_RUN_PROFILE_IMMUTABLE'); END;
            CREATE TABLE IF NOT EXISTS target_publications (
              id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES channel_bindings(id), variant_id TEXT NOT NULL,
              idempotency_key TEXT NOT NULL, approval_state TEXT NOT NULL, state TEXT NOT NULL,
              client_id TEXT REFERENCES clients(id), brand_id TEXT REFERENCES brands(id), simulation INTEGER NOT NULL DEFAULT 0,
              legacy_non_live INTEGER NOT NULL DEFAULT 0,
              terminal_at TEXT, provider_call_count INTEGER NOT NULL DEFAULT 0, provider_job_id TEXT,
              scheduled_at TEXT, target_external_id TEXT, target_platform TEXT, plan_id TEXT, content_run_id TEXT,
              revision INTEGER NOT NULL DEFAULT 0, worker_job_id TEXT, worker_revision INTEGER NOT NULL DEFAULT 0,
              pending_command_id TEXT, worker_ack_state TEXT NOT NULL DEFAULT 'unacknowledged'
            );
            CREATE UNIQUE INDEX IF NOT EXISTS target_publication_binding_key ON target_publications(binding_id, idempotency_key);
            CREATE TABLE IF NOT EXISTS publication_commands (
              request_id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES target_publications(id),
              action TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
              command_json TEXT NOT NULL, response_json TEXT, error_code TEXT,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS publication_commands_pending ON publication_commands(status, created_at);
            CREATE TABLE IF NOT EXISTS target_schedule_collision_reports (
              conflict_key TEXT PRIMARY KEY, target_platform TEXT NOT NULL, target_external_id TEXT NOT NULL,
              scheduled_at_utc TEXT NOT NULL, publication_ids_json TEXT NOT NULL, reported_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS automation_plans (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), state TEXT NOT NULL, generation_profile_id TEXT, binding_ids_json TEXT NOT NULL DEFAULT '[]', payload_json TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES automation_plans(id), state TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'scheduled', run_date TEXT, payload_json TEXT NOT NULL DEFAULT '{}');
            CREATE TABLE IF NOT EXISTS automation_plan_revisions (
              id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL REFERENCES automation_plans(id), revision INTEGER NOT NULL,
              payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(plan_id, revision)
            );
            CREATE TABLE IF NOT EXISTS media_assets (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL, metadata_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT NOT NULL REFERENCES brands(id), event_name TEXT NOT NULL, occurred_at TEXT NOT NULL, properties_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT NOT NULL REFERENCES brands(id), event_name TEXT NOT NULL, occurred_at TEXT NOT NULL, properties_json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS provider_configurations (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), provider_kind TEXT NOT NULL, display_name TEXT NOT NULL,
              model TEXT NOT NULL, status TEXT NOT NULL, capabilities_json TEXT NOT NULL, secret_ref TEXT, metadata_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_items (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT NOT NULL REFERENCES brands(id),
              title TEXT NOT NULL, content_hash TEXT NOT NULL, provenance TEXT NOT NULL, rights_state TEXT NOT NULL,
              review_state TEXT NOT NULL, archive_state TEXT NOT NULL DEFAULT 'active', metadata_json TEXT NOT NULL,
              UNIQUE(brand_id, content_hash)
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_items_fts USING fts5(id UNINDEXED, client_id UNINDEXED, brand_id UNINDEXED, title, body, source_title);
            CREATE TABLE IF NOT EXISTS prompt_blueprints (
              id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), identity_id TEXT REFERENCES brand_identities(id),
              kind TEXT NOT NULL, template TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS research_evidence (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT REFERENCES brands(id),
              source_url TEXT NOT NULL, source_title TEXT NOT NULL, retrieved_at TEXT NOT NULL, summary TEXT NOT NULL,
              rights_state TEXT NOT NULL, review_state TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'operator_selected'
            );
            CREATE TABLE IF NOT EXISTS trend_signals (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), source TEXT NOT NULL, observed_at TEXT NOT NULL,
              topic TEXT NOT NULL, metric TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS control_plane_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS brand_deletion_operations (
              id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, client_id TEXT NOT NULL,
              state TEXT NOT NULL, phase TEXT NOT NULL, error_code TEXT,
              requested_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS brand_deletion_operations_lookup ON brand_deletion_operations(brand_id, state, updated_at);
            CREATE UNIQUE INDEX IF NOT EXISTS one_pending_brand_deletion_operation ON brand_deletion_operations(brand_id) WHERE state IN ('pending', 'running');
            """
        )
        self.connection.commit()
        self._ensure_content_run_profile_nullable()
        self._ensure_brand_deleted_at()
        self._ensure_media_assets_brand_nullable()
        for table, column, definition in (("automation_plans", "generation_profile_id", "TEXT"), ("automation_plans", "binding_ids_json", "TEXT NOT NULL DEFAULT '[]'"), ("automation_plans", "payload_json", "TEXT NOT NULL DEFAULT '{}'"), ("automation_runs", "trigger", "TEXT NOT NULL DEFAULT 'scheduled'"), ("automation_runs", "run_date", "TEXT"), ("automation_runs", "payload_json", "TEXT NOT NULL DEFAULT '{}'")):
            if column not in {row[1] for row in self.connection.execute(f"PRAGMA table_info({table})").fetchall()}:
                self.connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        content_run_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(content_runs)").fetchall()}
        if "recipe_id" not in content_run_columns:
            self.connection.execute("ALTER TABLE content_runs ADD COLUMN recipe_id TEXT")
        if "payload_json" not in content_run_columns:
            self.connection.execute("ALTER TABLE content_runs ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'")
        if "payload_json" not in {row[1] for row in self.connection.execute("PRAGMA table_info(brand_identities)").fetchall()}:
            self.connection.execute("ALTER TABLE brand_identities ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'")
        target_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(target_publications)").fetchall()}
        self.connection.execute("DROP INDEX IF EXISTS target_publication_page_slot_key")
        for column, definition in (("client_id", "TEXT"), ("brand_id", "TEXT"), ("simulation", "INTEGER NOT NULL DEFAULT 0"), ("legacy_non_live", "INTEGER NOT NULL DEFAULT 0"), ("terminal_at", "TEXT"), ("provider_call_count", "INTEGER NOT NULL DEFAULT 0"), ("provider_job_id", "TEXT")):
            if column not in target_columns:
                self.connection.execute(f"ALTER TABLE target_publications ADD COLUMN {column} {definition}")
        for column, definition in (("scheduled_at", "TEXT"), ("target_external_id", "TEXT"), ("target_platform", "TEXT"), ("plan_id", "TEXT"), ("content_run_id", "TEXT"), ("revision", "INTEGER NOT NULL DEFAULT 0"), ("worker_job_id", "TEXT"), ("worker_revision", "INTEGER NOT NULL DEFAULT 0"), ("pending_command_id", "TEXT"), ("worker_ack_state", "TEXT NOT NULL DEFAULT 'unacknowledged'")):
            if column not in target_columns:
                self.connection.execute(f"ALTER TABLE target_publications ADD COLUMN {column} {definition}")
        self.connection.execute("UPDATE target_publications SET target_external_id = (SELECT target_external_id FROM channel_bindings WHERE id = target_publications.binding_id) WHERE target_external_id IS NULL")
        self.connection.execute("UPDATE target_publications SET target_platform = (SELECT c.platform FROM channel_bindings b JOIN connections c ON c.id = b.connection_id WHERE b.id = target_publications.binding_id) WHERE target_platform IS NULL")
        self.connection.execute("UPDATE target_publications SET legacy_non_live = 1, state = 'blocked', worker_ack_state = 'not_required', pending_command_id = NULL WHERE simulation = 1 AND legacy_non_live = 0")
        self.connection.execute("UPDATE publication_commands SET status = 'failed', error_code = 'LEGACY_NON_LIVE_ACTION_BLOCKED', updated_at = ? WHERE status = 'pending' AND publication_id IN (SELECT id FROM target_publications WHERE legacy_non_live = 1)", (datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),))
        self.connection.execute("CREATE INDEX IF NOT EXISTS target_publication_page_slot_lookup ON target_publications(target_platform, target_external_id, scheduled_at)")
        research_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(research_evidence)").fetchall()}
        if "source_type" not in research_columns:
            self.connection.execute("ALTER TABLE research_evidence ADD COLUMN source_type TEXT NOT NULL DEFAULT 'operator_selected'")
        self.connection.commit()
        self._record_schedule_collisions()
        self._ensure_media_receipt_guards()
        if self.control_plane_migrated():
            self.connection.execute("INSERT OR IGNORE INTO control_plane_metadata(key, value) VALUES ('strategy_catalog_schema_version', '5')")
            self.connection.commit()

    def _ensure_media_receipt_guards(self) -> None:
        # Tombstones stop a delayed writer from resurrecting a compensated receipt after its ACK was lost.
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS media_ownership_compensations (
              asset_id TEXT NOT NULL, receipt_id TEXT NOT NULL, PRIMARY KEY(asset_id, receipt_id)
            );
            CREATE TRIGGER IF NOT EXISTS media_receipt_deleted AFTER DELETE ON media_assets
              WHEN json_valid(OLD.metadata_json) AND json_type(OLD.metadata_json, '$.ownershipReceiptId') = 'text'
              BEGIN
                INSERT OR IGNORE INTO media_ownership_compensations(asset_id, receipt_id)
                  VALUES (OLD.id, json_extract(OLD.metadata_json, '$.ownershipReceiptId'));
              END;
            CREATE TRIGGER IF NOT EXISTS media_receipt_no_resurrection BEFORE INSERT ON media_assets
              WHEN EXISTS (SELECT 1 FROM media_ownership_compensations c WHERE c.asset_id = NEW.id
                AND c.receipt_id = json_extract(NEW.metadata_json, '$.ownershipReceiptId'))
              BEGIN SELECT RAISE(ABORT, 'MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED'); END;
        """)
        for operation in ("INSERT", "UPDATE OF payload_json"):
            name = "insert" if operation == "INSERT" else "update"
            # SQLite evaluates this in the same write statement as the run; a preflight/read-then-write can race.
            self.connection.execute(f"""
                CREATE TRIGGER IF NOT EXISTS content_run_compensated_media_{name} BEFORE {operation} ON content_runs
                  WHEN EXISTS (SELECT 1 FROM json_tree(NEW.payload_json) j
                    JOIN media_ownership_compensations c ON j.type = 'text' AND j.value = c.asset_id
                    WHERE NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.id = c.asset_id))
                  BEGIN SELECT RAISE(ABORT, 'MEDIA_OWNERSHIP_RECONCILIATION_REQUIRED'); END
            """)
        self.connection.commit()

    def _ensure_content_run_profile_nullable(self) -> None:
        """Migrate older stores so safe/manual Content Runs can omit a provider profile."""
        columns = self.connection.execute("PRAGMA table_info(content_runs)").fetchall()
        profile = next((row for row in columns if row[1] == "generation_profile_id"), None)
        if profile is None or int(profile[3]) == 0:
            return
        self.connection.execute("DROP TRIGGER IF EXISTS content_run_profile_immutable")
        self.connection.execute("PRAGMA foreign_keys = OFF")
        self.connection.execute("ALTER TABLE content_runs RENAME TO content_runs_legacy")
        self.connection.execute(
            """
            CREATE TABLE content_runs (
              id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT NOT NULL REFERENCES brands(id),
              identity_version_id TEXT NOT NULL REFERENCES brand_identities(id), generation_profile_id TEXT REFERENCES generation_profiles(id),
              execution_mode TEXT NOT NULL CHECK(execution_mode IN ('subscription_package', 'llm_provider')), provider_attempted INTEGER NOT NULL DEFAULT 0 CHECK(provider_attempted IN (0, 1)), recipe_id TEXT,
              payload_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        legacy_columns = {row[1] for row in self.connection.execute("PRAGMA table_info(content_runs_legacy)").fetchall()}
        columns_to_copy = [column for column in ("id", "client_id", "brand_id", "identity_version_id", "generation_profile_id", "execution_mode", "provider_attempted", "recipe_id", "payload_json") if column in legacy_columns]
        columns_sql = ", ".join(columns_to_copy)
        self.connection.execute(f"INSERT INTO content_runs ({columns_sql}) SELECT {columns_sql} FROM content_runs_legacy")
        self.connection.execute("DROP TABLE content_runs_legacy")
        self.connection.execute(
            """
            CREATE TRIGGER content_run_profile_immutable
              BEFORE UPDATE OF generation_profile_id ON content_runs
              WHEN OLD.provider_attempted = 1
              BEGIN SELECT RAISE(ABORT, 'CONTENT_RUN_PROFILE_IMMUTABLE'); END
            """
        )
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.commit()

    def _ensure_brand_deleted_at(self) -> None:
        columns = {row[1] for row in self.connection.execute("PRAGMA table_info(brands)").fetchall()}
        if "deleted_at" not in columns:
            self.connection.execute("ALTER TABLE brands ADD COLUMN deleted_at TEXT")
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.connection.execute("UPDATE brands SET deleted_at = ? WHERE status = 'archived' AND deleted_at IS NULL", (now,))
        self.connection.commit()

    def _ensure_media_assets_brand_nullable(self) -> None:
        columns = self.connection.execute("PRAGMA table_info(media_assets)").fetchall()
        brand_column = next((row for row in columns if row[1] == "brand_id"), None)
        if brand_column is None or int(brand_column[3]) == 0:
            return
        self.connection.commit()
        self.connection.execute("PRAGMA foreign_keys = OFF")
        try:
            self.connection.execute("ALTER TABLE media_assets RENAME TO media_assets_legacy")
            self.connection.execute("CREATE TABLE media_assets (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL, metadata_json TEXT NOT NULL)")
            self.connection.execute("INSERT INTO media_assets(id, client_id, brand_id, metadata_json) SELECT id, client_id, brand_id, metadata_json FROM media_assets_legacy")
            self.connection.execute("DROP TABLE media_assets_legacy")
            self.connection.commit()
        finally:
            self.connection.execute("PRAGMA foreign_keys = ON")
            self.connection.commit()

    def _insert(self, statement: str, values: tuple[Any, ...], conflict_code: str) -> None:
        try:
            self.connection.execute(statement, values)
            self.connection.commit()
        except sqlite3.IntegrityError as error:
            raise StateValidationError(conflict_code) from error

    def _row(self, statement: str, values: tuple[Any, ...], code: str) -> sqlite3.Row:
        row = self.connection.execute(statement, values).fetchone()
        if row is None:
            raise StateValidationError(code)
        return row

    def bind_brand_actor(self, brand_id: str, actor_user_id: str, role: str, capabilities: list[str] | None = None) -> dict[str, Any]:
        brand = self._brand(brand_id)
        actor_user_id = self._text(actor_user_id, "BRAND_ACTOR_REQUIRED", 128)
        role = self._text(role, "BRAND_ROLE_INVALID", 40)
        capabilities = capabilities or ["manage_brand"]
        if not all(isinstance(item, str) and item for item in capabilities):
            raise StateValidationError("BRAND_CAPABILITIES_INVALID")
        self.connection.execute("INSERT OR REPLACE INTO brand_actor_bindings(brand_id, actor_user_id, role, capabilities_json) VALUES (?, ?, ?, ?)", (brand["id"], actor_user_id, role, json.dumps(sorted(set(capabilities)), separators=(",", ":"))))
        self.connection.commit()
        return {"brandId": brand["id"], "actorUserId": actor_user_id, "role": role, "capabilities": sorted(set(capabilities))}

    def backfill_brand_actor_bindings(self, value: dict[str, Any]) -> dict[str, int]:
        self._validate_scalar(value)
        if not self.control_plane_migrated():
            raise StateValidationError("BRAND_ACTOR_BACKFILL_REQUIRES_MIGRATION")
        actor_binding = self._actor_binding_from_payload(value)
        if actor_binding is None:
            raise StateValidationError("BRAND_ACTOR_REQUIRED")
        requested_ids = value.get("brandIds")
        if requested_ids is not None and (not isinstance(requested_ids, list) or not all(isinstance(item, str) and item.strip() for item in requested_ids)):
            raise StateValidationError("BRAND_ID_INVALID")
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            if requested_ids is None:
                brands = self.connection.execute("SELECT id FROM brands ORDER BY id").fetchall()
            elif requested_ids:
                placeholders = ",".join("?" for _ in requested_ids)
                brands = self.connection.execute(f"SELECT id FROM brands WHERE id IN ({placeholders}) ORDER BY id", tuple(requested_ids)).fetchall()
                if len(brands) != len(set(requested_ids)):
                    raise StateValidationError("BRAND_MISSING")
            else:
                brands = []
            seeded = 0
            actor_user_id, role, capabilities = actor_binding
            for brand in brands:
                if self.connection.execute("SELECT 1 FROM brand_actor_bindings WHERE brand_id = ? LIMIT 1", (brand["id"],)).fetchone() is not None:
                    continue
                self.connection.execute("INSERT INTO brand_actor_bindings(brand_id, actor_user_id, role, capabilities_json) VALUES (?, ?, ?, ?)", (brand["id"], actor_user_id, role, json.dumps(capabilities, separators=(",", ":"))))
                seeded += 1
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            raise StateValidationError("BRAND_ACTOR_BACKFILL_CONFLICT") from error
        return {"seededCount": seeded, "brandCount": len(brands)}

    def _actor_binding_from_payload(self, value: dict[str, Any]) -> tuple[str, str, list[str]] | None:
        candidate_value = value.get("migrationActor") if isinstance(value.get("migrationActor"), dict) else value.get("actor")
        candidate = candidate_value if isinstance(candidate_value, dict) else value
        actor_user_id = candidate.get("actorUserId")
        if actor_user_id is None:
            return None
        actor_user_id = self._text(actor_user_id, "BRAND_ACTOR_REQUIRED", 128)
        role = candidate.get("role") or candidate.get("actorRole") or "owner"
        role = self._text(role, "BRAND_ROLE_INVALID", 40)
        capabilities_value = candidate.get("capabilities") or candidate.get("actorCapabilities")
        if capabilities_value is None:
            capabilities_value = [candidate.get("capability") or "manage_brand"]
        if not isinstance(capabilities_value, list) or not all(isinstance(item, str) and item for item in capabilities_value):
            raise StateValidationError("BRAND_CAPABILITIES_INVALID")
        capabilities = sorted(set(capabilities_value))
        if role not in _MANAGE_BRAND_ROLES or "manage_brand" not in capabilities:
            raise StateValidationError("BRAND_MANAGE_FORBIDDEN")
        return actor_user_id, role, capabilities

    def _require_manage_brand(self, actor: dict[str, Any] | None, brand_id: str | None = None) -> None:
        if not isinstance(actor, dict):
            raise StateValidationError("BRAND_ACTOR_REQUIRED")
        actor_user_id = actor.get("actorUserId")
        if not isinstance(actor_user_id, str) or not actor_user_id.strip():
            raise StateValidationError("BRAND_ACTOR_REQUIRED")
        if brand_id:
            binding = self.connection.execute("SELECT role, capabilities_json FROM brand_actor_bindings WHERE brand_id = ? AND actor_user_id = ?", (brand_id, actor_user_id.strip())).fetchone()
            if binding is not None:
                try:
                    capabilities = json.loads(binding["capabilities_json"] or "[]")
                except json.JSONDecodeError:
                    capabilities = []
                if binding["role"] not in _MANAGE_BRAND_ROLES or "manage_brand" not in capabilities:
                    raise StateValidationError("BRAND_MANAGE_FORBIDDEN")
                return
        raise StateValidationError("BRAND_MANAGE_FORBIDDEN")

    def _brand(self, brand_id: str) -> sqlite3.Row:
        return self._row("SELECT id, client_id, name, status, deleted_at FROM brands WHERE id = ?", (self._text(brand_id, "BRAND_ID_INVALID", 128),), "BRAND_MISSING")

    @staticmethod
    def _brand_is_trashed(brand: sqlite3.Row) -> bool:
        return bool(brand["deleted_at"])

    @staticmethod
    def _shared_media_metadata(metadata: dict[str, Any]) -> bool:
        shared_brand_ids = metadata.get("sharedBrandIds") or metadata.get("shared_brand_ids")
        return metadata.get("shared") is True or metadata.get("distribution") == "universal" or isinstance(shared_brand_ids, list) and len(shared_brand_ids) > 0

    @staticmethod
    def _json_mentions_asset(value: Any, asset_id: str) -> bool:
        if isinstance(value, dict):
            for key, item in value.items():
                normalized = str(key).lower().replace("_", "").replace("-", "")
                if normalized in {"mediaassetid", "assetid"} and str(item) == asset_id:
                    return True
                if normalized in {"mediaassetids", "usedmediaassetids", "referencedmediaassetids"} and isinstance(item, list) and asset_id in {str(candidate) for candidate in item}:
                    return True
                if normalized in {"mediaevidence", "media", "assets", "references"} and AgencyStateStore._json_mentions_asset(item, asset_id):
                    return True
                if AgencyStateStore._json_mentions_asset(item, asset_id):
                    return True
        elif isinstance(value, list):
            return any(AgencyStateStore._json_mentions_asset(item, asset_id) for item in value)
        return False

    def _media_asset_referenced_by_other_scope(self, asset_id: str, brand_id: str) -> bool:
        rows = self.connection.execute("SELECT brand_id, payload_json FROM content_runs WHERE brand_id != ?", (brand_id,)).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except json.JSONDecodeError:
                return True
            if self._json_mentions_asset(payload, asset_id):
                return True
        rows = self.connection.execute("SELECT p.brand_id, c.command_json FROM target_publications p JOIN publication_commands c ON c.publication_id = p.id WHERE p.brand_id != ?", (brand_id,)).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["command_json"] or "{}")
            except json.JSONDecodeError:
                return True
            if self._json_mentions_asset(payload, asset_id):
                return True
        return False

    def _brand_impact_counts(self, brand_id: str) -> dict[str, int]:
        drafts = self.connection.execute("SELECT COUNT(*) AS count FROM content_runs WHERE brand_id = ?", (brand_id,)).fetchone()["count"]
        plans = self.connection.execute("SELECT COUNT(*) AS count FROM automation_plans WHERE brand_id = ?", (brand_id,)).fetchone()["count"]
        # A target publication owns its optional worker_job_id. Count the durable
        # publication row once; the worker representation is not another schedule.
        unsent = self.connection.execute("SELECT COUNT(DISTINCT id) AS count FROM target_publications WHERE brand_id = ? AND state NOT IN ('published', 'canceled', 'cancelled', 'failed', 'permanent_error', 'approval_failed', 'blocked')", (brand_id,)).fetchone()["count"]
        shared = 0
        for row in self.connection.execute("SELECT id, metadata_json FROM media_assets WHERE brand_id = ?", (brand_id,)).fetchall():
            try:
                metadata = json.loads(row["metadata_json"] or "{}")
            except json.JSONDecodeError:
                metadata = {}
            if isinstance(metadata, dict) and (self._shared_media_metadata(metadata) or self._media_asset_referenced_by_other_scope(str(row["id"]), brand_id)):
                shared += 1
        return {"draftCount": int(drafts), "planCount": int(plans), "unsentScheduleCount": int(unsent), "sharedMediaCount": shared}

    @staticmethod
    def _brand_impact_revision(brand: sqlite3.Row, counts: dict[str, int], blockers: list[str]) -> str:
        identity = {
            "clientId": str(brand["client_id"]),
            "brandId": str(brand["id"]),
            "brandName": str(brand["name"]),
            "brandStatus": str(brand["status"]),
            "deletedAt": brand["deleted_at"],
            "counts": counts,
            "blockers": sorted(str(item) for item in blockers),
        }
        return sha256(json.dumps(identity, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _validate_brand_impact_counts(counts: Any) -> dict[str, int]:
        if not isinstance(counts, dict) or set(counts) != set(_BRAND_IMPACT_COUNT_KEYS):
            raise StateValidationError("BRAND_IMPACT_COUNTS_INVALID")
        normalized: dict[str, int] = {}
        for key in _BRAND_IMPACT_COUNT_KEYS:
            value = counts[key]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise StateValidationError("BRAND_IMPACT_COUNTS_INVALID")
            normalized[key] = value
        return normalized

    def brand_impact_preview(self, brand_id: str) -> dict[str, Any]:
        """Return one durable, scope-validated snapshot for brand deletion review."""
        brand = self._brand(self._text(brand_id, "BRAND_ID_INVALID", 128))
        counts = self._validate_brand_impact_counts(self._brand_impact_counts(brand["id"]))
        blockers = self._brand_publication_blockers(brand["id"])
        observed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        identity = {
            "clientId": brand["client_id"],
            "brandId": brand["id"],
            "brandStatus": brand["status"],
            "deletedAt": brand["deleted_at"],
        }
        return {
            "clientId": brand["client_id"],
            "brandId": brand["id"],
            "brandName": brand["name"],
            "brandStatus": brand["status"],
            "deletedAt": brand["deleted_at"],
            "counts": counts,
            "blockers": blockers,
            "observedAt": observed_at,
            "revision": self._brand_impact_revision(brand, counts, blockers),
            "identity": identity,
        }

    def _brand_publication_blockers(self, brand_id: str) -> list[str]:
        rows = self.connection.execute("SELECT id, state, simulation, worker_ack_state, provider_job_id FROM target_publications WHERE brand_id = ?", (brand_id,)).fetchall()
        blockers: list[str] = []
        safe_acknowledgements = {"acknowledged", "confirmed", "accepted"}
        safe_failed_states = {"failed", "approval_failed", "permanent_error", "blocked"}
        for row in rows:
            state = str(row["state"] or "")
            ack = str(row["worker_ack_state"] or "")
            provider_evidence = isinstance(row["provider_job_id"], str) and bool(row["provider_job_id"].strip())
            terminal = state in _TERMINAL_PUBLICATION_STATES
            if state == "published" and provider_evidence:
                continue
            if terminal and state != "published" and ack in safe_acknowledgements:
                continue
            if terminal and state in safe_failed_states and ack == "failed":
                continue
            if terminal and bool(row["simulation"]) and ack == "not_required":
                continue
            blockers.append(str(row["id"]))
        return blockers

    def list_brand_deletion_operations(self, brand_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT id, brand_id, client_id, state, phase, error_code, requested_at, updated_at, completed_at FROM brand_deletion_operations"
        values: tuple[Any, ...] = ()
        if brand_id is not None:
            query += " WHERE brand_id = ?"
            values = (self._text(brand_id, "BRAND_ID_INVALID", 128),)
        query += " ORDER BY requested_at, id"
        return [{"id": row["id"], "brandId": row["brand_id"], "clientId": row["client_id"], "state": row["state"], "phase": row["phase"], "errorCode": row["error_code"], "requestedAt": row["requested_at"], "updatedAt": row["updated_at"], "completedAt": row["completed_at"]} for row in self.connection.execute(query, values).fetchall()]

    def create_client(self, value: dict[str, Any]) -> dict[str, str]:
        self._validate_scalar(value)
        record = {"id": self._text(value.get("id"), "CLIENT_ID_INVALID", 128), "name": self._text(value.get("name"), "CLIENT_NAME_INVALID"), "timezone": self._text(value.get("timezone"), "CLIENT_TIMEZONE_INVALID", 100), "status": self._text(value.get("status"), "CLIENT_STATUS_INVALID", 40)}
        self._insert("INSERT INTO clients(id, name, timezone, status) VALUES (?, ?, ?, ?)", tuple(record.values()), "CLIENT_CONFLICT")
        return record

    def create_brand(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        status = self._text(value.get("status"), "BRAND_STATUS_INVALID", 40)
        deleted_at = value.get("deletedAt")
        if status == "archived" and deleted_at is None:
            deleted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        if deleted_at is not None:
            deleted_at = self._text(deleted_at, "BRAND_DELETED_AT_INVALID", 80)
            if _parse_iso_date(deleted_at) is None:
                raise StateValidationError("BRAND_DELETED_AT_INVALID")
        record = {"id": self._text(value.get("id"), "BRAND_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "BRAND_CLIENT_MISSING", 128), "name": self._text(value.get("name"), "BRAND_NAME_INVALID"), "status": status, "deletedAt": deleted_at}
        existing = self.connection.execute("SELECT client_id FROM brands WHERE id = ?", (record["id"],)).fetchone()
        if existing is not None:
            raise StateValidationError("BRAND_ID_SCOPE_CONFLICT" if existing["client_id"] != record["clientId"] else "BRAND_CONFLICT")
        actor_binding = self._actor_binding_from_payload(value)
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            self.connection.execute("INSERT INTO brands(id, client_id, name, status, deleted_at) VALUES (?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["name"], record["status"], record["deletedAt"]))
            if actor_binding is not None:
                actor_user_id, role, capabilities = actor_binding
                self.connection.execute("INSERT INTO brand_actor_bindings(brand_id, actor_user_id, role, capabilities_json) VALUES (?, ?, ?, ?)", (record["id"], actor_user_id, role, json.dumps(capabilities, separators=(",", ":"))))
            self.connection.commit()
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            raise StateValidationError("BRAND_CLIENT_MISSING") from error
        return record

    def create_identity(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        if "catalog" in value:
            raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
        record = {"id": self._text(value.get("id"), "IDENTITY_ID_INVALID", 128), "brandId": self._text(value.get("brandId"), "IDENTITY_BRAND_MISSING", 128), "name": self._text(value.get("name"), "IDENTITY_NAME_INVALID"), "isDefault": bool(value.get("isDefault")), "version": value.get("version"), "status": self._text(value.get("status"), "IDENTITY_STATUS_INVALID", 40)}
        if not isinstance(record["version"], int) or record["version"] < 1:
            raise StateValidationError("IDENTITY_VERSION_INVALID")
        conflict = "IDENTITY_DEFAULT_CONFLICT" if record["isDefault"] else "IDENTITY_CONFLICT"
        brand = self._row("SELECT client_id, deleted_at FROM brands WHERE id = ?", (record["brandId"],), "IDENTITY_BRAND_MISSING")
        if value.get("clientId") is not None and value.get("clientId") != brand["client_id"]:
            raise StateValidationError("IDENTITY_CLIENT_MISMATCH")
        payload = {key: value[key] for key in ("strategy", "voice", "visual") if key in value}
        strategy_catalog = value.get("strategyCatalog")
        if strategy_catalog is not None:
            if not record["isDefault"]:
                raise StateValidationError("STRATEGY_CATALOG_IDENTITY_NONCANONICAL")
            brand = self._row("SELECT id, client_id, status, deleted_at FROM brands WHERE id = ?", (record["brandId"],), "IDENTITY_BRAND_MISSING")
            if value.get("clientId", brand["client_id"]) != brand["client_id"]:
                raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
            if brand["status"] != "active" or brand["deleted_at"]:
                raise StateValidationError("STRATEGY_CATALOG_BRAND_NOT_ACTIVE")
            if brand["status"] == "active" and not brand["deleted_at"]:
                actor = value.get("actor") if isinstance(value.get("actor"), dict) else value if value.get("actorUserId") else None
                self._require_manage_brand(actor, record["brandId"])
                _validate_strategy_catalog(strategy_catalog, record["brandId"])
                self._validate_strategy_catalog_recipe_registry(strategy_catalog)
                payload["strategyCatalog"] = strategy_catalog
                payload["strategyCatalogRevision"] = 0
        self._insert("INSERT INTO brand_identities(id, brand_id, name, is_default, version, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)", (record["id"], record["brandId"], record["name"], int(record["isDefault"]), record["version"], record["status"], json.dumps(payload, separators=(",", ":"))), conflict)
        return record

    def update_identity_payload(self, identity_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(payload)
        identity_id = self._text(identity_id, "IDENTITY_ID_INVALID", 128)
        if not isinstance(payload, dict):
            raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
        if "catalog" in payload:
            raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
        if "strategyCatalog" in payload:
            catalog = payload["strategyCatalog"]
            allowed_metadata = {"strategyCatalog", "clientId", "brandId", "scopeKey", "expectedVersion", "expectedCatalogVersion", "version", "expectedRevision", "strategyCatalogRevision", "revision", "fingerprint", "actor", "actorUserId", "role", "capability", "capabilities", "identityId", "strategy", "voice", "visual"}
            if set(payload).difference(allowed_metadata):
                raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
            actor = payload.get("actor") if isinstance(payload.get("actor"), dict) else payload if payload.get("actorUserId") else None
            return self.save_strategy_catalog({**payload, "identityId": identity_id, "strategyCatalog": catalog, **({"actor": actor} if actor else {})})
        if set(payload).difference({"strategy", "voice", "visual"}):
            raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
        row = self._row("SELECT id, brand_id, name, is_default, version, status, payload_json FROM brand_identities WHERE id = ?", (identity_id,), "IDENTITY_MISSING")
        allowed = {key: payload[key] for key in ("strategy", "voice", "visual") if key in payload}
        if not allowed:
            raise StateValidationError("IDENTITY_PAYLOAD_INVALID")
        current = json.loads(row["payload_json"] or "{}")
        current.update(allowed)
        self.connection.execute("UPDATE brand_identities SET payload_json = ? WHERE id = ?", (json.dumps(current, separators=(",", ":")), identity_id))
        self.connection.commit()
        return {"id": row["id"], "brandId": row["brand_id"], "name": row["name"], "isDefault": bool(row["is_default"]), "version": row["version"], "status": row["status"], **current}

    def get_strategy_catalog(self, client_id: str, brand_id: str) -> dict[str, Any] | None:
        client_id = self._text(client_id, "STRATEGY_CATALOG_CLIENT_MISSING", 128)
        brand_id = self._text(brand_id, "STRATEGY_CATALOG_BRAND_MISSING", 128)
        rows = self.connection.execute(
            "SELECT i.id, i.brand_id, i.payload_json FROM brand_identities i JOIN brands b ON b.id = i.brand_id WHERE b.client_id = ? AND b.id = ? AND b.status != 'archived' AND b.deleted_at IS NULL AND i.is_default = 1 ORDER BY i.version DESC, i.id",
            (client_id, brand_id),
        ).fetchall()
        for row in rows:
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            catalog = payload.get("strategyCatalog") if isinstance(payload, dict) else None
            if not isinstance(catalog, dict):
                continue
            try:
                _validate_strategy_catalog(catalog, brand_id, allow_reduced_objectives=True)
                self._validate_strategy_catalog_recipe_registry(catalog)
            except StateValidationError:
                continue
            revision = payload.get("strategyCatalogRevision", 0)
            revision = revision if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0 else 0
            fingerprint = strategy_catalog_fingerprint(catalog)
            return {"scopeKey": strategy_catalog_scope_key(client_id, brand_id), "clientId": client_id, "brandId": brand_id, "identityId": row["id"], "strategyCatalog": catalog, "version": catalog["version"], "revision": revision, "fingerprint": fingerprint}
        return None

    def strategy_catalog_migration_version(self) -> int | None:
        row = self.connection.execute("SELECT value FROM control_plane_metadata WHERE key = 'strategy_catalog_schema_version'").fetchone()
        try:
            version = int(row["value"]) if row is not None else None
        except (TypeError, ValueError):
            return None
        return version if version and version > 0 else None

    def list_strategy_catalogs(self, client_id: str) -> list[dict[str, Any]]:
        client_id = self._text(client_id, "STRATEGY_CATALOG_CLIENT_MISSING", 128)
        rows = self.connection.execute("SELECT id FROM brands WHERE client_id = ? ORDER BY id", (client_id,)).fetchall()
        return [catalog for row in rows if (catalog := self.get_strategy_catalog(client_id, str(row["id"]))) is not None]

    def _validate_strategy_catalog_recipe_registry(self, catalog: dict[str, Any]) -> None:
        table = self.connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_recipes'").fetchone()
        if table is None:
            return
        columns = {row[1] for row in self.connection.execute("PRAGMA table_info(content_recipes)").fetchall()}
        if not {"id", "brand_id", "status"}.issubset(columns):
            return
        has_angle = "angle_id" in columns
        select = "SELECT brand_id, status" + (", angle_id" if has_angle else "") + " FROM content_recipes WHERE id = ? LIMIT 1"
        for angle_id, recipe_id in _strategy_recipe_references(catalog):
            row = self.connection.execute(select, (recipe_id,)).fetchone()
            if row is None or row["brand_id"] != catalog["brandId"] or row["status"] != "active" or (has_angle and row["angle_id"] not in (None, angle_id)):
                raise StateValidationError("RECIPE_REFERENCE_INVALID")

    def save_strategy_catalog(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        if not isinstance(value, dict):
            raise StateValidationError("STRATEGY_CATALOG_PAYLOAD_INVALID")
        if "catalog" in value:
            raise StateValidationError("STRATEGY_CATALOG_PAYLOAD_INVALID")
        allowed = {"clientId", "brandId", "identityId", "strategyCatalog", "scopeKey", "expectedVersion", "expectedCatalogVersion", "version", "expectedRevision", "strategyCatalogRevision", "revision", "fingerprint", "actor", "actorUserId", "role", "capability", "capabilities", "strategy", "voice", "visual"}
        if set(value).difference(allowed):
            raise StateValidationError("STRATEGY_CATALOG_PAYLOAD_INVALID")
        client_id = self._text(value.get("clientId"), "STRATEGY_CATALOG_CLIENT_MISSING", 128)
        brand_id = self._text(value.get("brandId"), "STRATEGY_CATALOG_BRAND_MISSING", 128)
        if value.get("scopeKey") is not None and value.get("scopeKey") != strategy_catalog_scope_key(client_id, brand_id):
            raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
        catalog = value.get("strategyCatalog")
        _validate_strategy_catalog(catalog, brand_id)
        requested_version = value.get("expectedVersion", value.get("expectedCatalogVersion", value.get("version", catalog["version"])))
        if not isinstance(requested_version, int) or isinstance(requested_version, bool) or requested_version < 1:
            raise StateValidationError("STRATEGY_CATALOG_VERSION_INVALID")
        expected_version = int(requested_version)
        expected_revision = value.get("expectedRevision", value.get("strategyCatalogRevision", value.get("revision", 0)))
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 0:
            raise StateValidationError("STRATEGY_CATALOG_REVISION_INVALID")
        requested_fingerprint = value.get("fingerprint")
        if requested_fingerprint is not None and requested_fingerprint != strategy_catalog_fingerprint(catalog):
            raise StateValidationError("STRATEGY_CATALOG_FINGERPRINT_MISMATCH")
        self._validate_strategy_catalog_recipe_registry(catalog)
        brand = self._row("SELECT id, client_id, status, deleted_at FROM brands WHERE id = ?", (brand_id,), "STRATEGY_CATALOG_BRAND_MISSING")
        if brand["client_id"] != client_id:
            raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
        if brand["deleted_at"]:
            raise StateValidationError("BRAND_TRASHED")
        if brand["status"] != "active":
            raise StateValidationError("STRATEGY_CATALOG_BRAND_NOT_ACTIVE")
        actor = value.get("actor") if isinstance(value.get("actor"), dict) else value if value.get("actorUserId") else None
        self._require_manage_brand(actor, brand_id)
        identity_id = value.get("identityId")
        if identity_id is not None:
            identity_id = self._text(identity_id, "STRATEGY_CATALOG_IDENTITY_INVALID", 128)
        identity_fields = {key: value[key] for key in ("strategy", "voice", "visual") if key in value}
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            identity = self.connection.execute(
                "SELECT i.id, i.brand_id, i.is_default, i.payload_json FROM brand_identities i JOIN brands b ON b.id = i.brand_id WHERE b.client_id = ? AND b.id = ? AND i.is_default = 1 AND (? IS NULL OR i.id = ?) ORDER BY i.version DESC, i.id LIMIT 1",
                (client_id, brand_id, identity_id, identity_id),
            ).fetchone()
            if identity is None and identity_id is not None:
                noncanonical = self.connection.execute("SELECT 1 FROM brand_identities WHERE id = ? AND brand_id = ? AND is_default = 0", (identity_id, brand_id)).fetchone()
                if noncanonical is not None:
                    raise StateValidationError("STRATEGY_CATALOG_IDENTITY_NONCANONICAL")
            if identity is None:
                raise StateValidationError("STRATEGY_CATALOG_IDENTITY_MISSING")
            try:
                current_payload = json.loads(identity["payload_json"] or "{}")
            except (TypeError, json.JSONDecodeError):
                raise StateValidationError("STRATEGY_CATALOG_STORED_SCHEMA_INVALID")
            if not isinstance(current_payload, dict):
                raise StateValidationError("STRATEGY_CATALOG_STORED_SCHEMA_INVALID")
            current_catalog = current_payload.get("strategyCatalog")
            if current_catalog is not None:
                try:
                    _validate_strategy_catalog(current_catalog, brand_id, allow_reduced_objectives=True)
                except StateValidationError as error:
                    raise StateValidationError("STRATEGY_CATALOG_STORED_SCHEMA_INVALID") from error
            current_version = current_catalog.get("version", 1) if isinstance(current_catalog, dict) and isinstance(current_catalog.get("version"), int) else 1
            current_revision = current_payload.get("strategyCatalogRevision", 0) if isinstance(current_payload.get("strategyCatalogRevision"), int) and not isinstance(current_payload.get("strategyCatalogRevision"), bool) and current_payload.get("strategyCatalogRevision", 0) >= 0 else 0
            if expected_version != current_version:
                raise StateValidationError("STRATEGY_CATALOG_VERSION_CONFLICT")
            if expected_revision != current_revision:
                raise StateValidationError("STRATEGY_CATALOG_REVISION_CONFLICT")
            if catalog["version"] != expected_version:
                raise StateValidationError("STRATEGY_CATALOG_VERSION_CONFLICT")
            saved_catalog = {**catalog, "version": current_version + 1}
            next_payload = {**current_payload, **identity_fields, "strategyCatalog": saved_catalog, "strategyCatalogRevision": current_revision + 1}
            self.connection.execute("UPDATE brand_identities SET payload_json = ? WHERE id = ?", (json.dumps(next_payload, ensure_ascii=False, separators=(",", ":")), identity["id"]))
            self.connection.execute("INSERT OR REPLACE INTO control_plane_metadata(key, value) VALUES ('strategy_catalog_schema_version', '5')")
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.DatabaseError as error:
            self.connection.rollback()
            raise StateValidationError("STRATEGY_CATALOG_SAVE_FAILED") from error
        fingerprint = strategy_catalog_fingerprint(saved_catalog)
        return {"scopeKey": strategy_catalog_scope_key(client_id, brand_id), "clientId": client_id, "brandId": brand_id, "identityId": identity["id"], "strategyCatalog": saved_catalog, "version": saved_catalog["version"], "revision": current_revision + 1, "fingerprint": fingerprint, "acknowledged": True}

    save_brand_strategy_catalog = save_strategy_catalog
    update_strategy_catalog = save_strategy_catalog
    load_strategy_catalog = get_strategy_catalog

    def acknowledge_strategy_catalog(self, client_id: str, brand_id: str, revision: int, version: int, fingerprint: str, scope_key: str) -> dict[str, Any]:
        expected_scope_key = strategy_catalog_scope_key(client_id, brand_id)
        if scope_key != expected_scope_key:
            raise StateValidationError("STRATEGY_CATALOG_ACK_SCOPE_MISMATCH")
        current = self.get_strategy_catalog(client_id, brand_id)
        if current is None:
            raise StateValidationError("STRATEGY_CATALOG_MISSING")
        if revision != current["revision"] or version != current["version"] or fingerprint != current["fingerprint"]:
            raise StateValidationError("STRATEGY_CATALOG_ACK_INVALID")
        return current

    def create_connection(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        scopes = value.get("scopes", [])
        if not isinstance(scopes, list) or not all(isinstance(scope, str) and scope for scope in scopes):
            raise StateValidationError("CONNECTION_SCOPES_INVALID")
        record = {"id": self._text(value.get("id"), "CONNECTION_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "CONNECTION_CLIENT_MISSING", 128), "platform": self._text(value.get("platform"), "CONNECTION_PLATFORM_INVALID", 40), "externalAccountId": self._text(value.get("externalAccountId"), "CONNECTION_ACCOUNT_INVALID", 128), "displayName": self._text(value.get("displayName"), "CONNECTION_NAME_INVALID"), "connectionState": self._text(value.get("connectionState"), "CONNECTION_STATE_INVALID", 40), "scopes": scopes}
        secret_ref = value.get("secretRef")
        if secret_ref is not None and (not isinstance(secret_ref, str) or not re.fullmatch(r"(?:env|keychain):[A-Za-z0-9/_:.+-]{1,240}", secret_ref)):
            raise StateValidationError("CONNECTION_SECRET_REF_INVALID")
        self._insert("INSERT INTO connections(id, client_id, platform, external_account_id, display_name, connection_state, scopes_json, secret_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["platform"], record["externalAccountId"], record["displayName"], record["connectionState"], json.dumps(scopes, separators=(",", ":")), secret_ref), "CONNECTION_CLIENT_MISSING")
        return record

    def create_binding(self, value: dict[str, Any]) -> dict[str, str]:
        self._validate_scalar(value)
        record = {key: self._text(value.get(key), f"BINDING_{key.upper()}_INVALID", 160) for key in ("id", "brandId", "identityId", "connectionId", "targetExternalId", "targetName", "state")}
        brand = self._row("SELECT client_id FROM brands WHERE id = ?", (record["brandId"],), "BINDING_BRAND_MISSING")
        identity = self.connection.execute("SELECT brand_id FROM brand_identities WHERE id = ?", (record["identityId"],)).fetchone()
        if identity is None or identity["brand_id"] != record["brandId"]:
            raise StateValidationError("BINDING_IDENTITY_MISMATCH")
        connection = self._row("SELECT client_id FROM connections WHERE id = ?", (record["connectionId"],), "BINDING_CONNECTION_MISSING")
        if connection["client_id"] != brand["client_id"]:
            raise StateValidationError("CONNECTION_CLIENT_MISMATCH")
        self._insert("INSERT INTO channel_bindings(id, brand_id, identity_id, connection_id, target_external_id, target_name, state) VALUES (?, ?, ?, ?, ?, ?, ?)", tuple(record.values()), "BINDING_CONFLICT")
        return record

    def create_generation_profile(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        mode = value.get("mode")
        if mode not in _GENERATION_MODES:
            raise StateValidationError("GENERATION_MODE_INVALID")
        capabilities = value.get("capabilities", [])
        if not isinstance(capabilities, list) or not all(isinstance(capability, str) and capability for capability in capabilities):
            raise StateValidationError("GENERATION_CAPABILITIES_INVALID")
        record = {"id": self._text(value.get("id"), "PROFILE_ID_INVALID", 128), "brandId": self._text(value.get("brandId"), "PROFILE_BRAND_MISSING", 128), "mode": mode, "provider": self._text(value.get("provider"), "PROFILE_PROVIDER_INVALID", 100), "model": self._text(value.get("model"), "PROFILE_MODEL_INVALID", 240), "capabilities": capabilities, "status": self._text(value.get("status"), "PROFILE_STATUS_INVALID", 40)}
        secret_ref = value.get("secretRef")
        if secret_ref is not None and (not isinstance(secret_ref, str) or not re.fullmatch(r"(?:env|keychain):[A-Za-z0-9/_:.+-]{1,240}", secret_ref)):
            raise StateValidationError("PROFILE_SECRET_REF_INVALID")
        self._insert("INSERT INTO generation_profiles(id, brand_id, mode, provider, model, capabilities_json, status, secret_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["brandId"], record["mode"], record["provider"], record["model"], json.dumps(capabilities, separators=(",", ":")), record["status"], secret_ref), "PROFILE_BRAND_MISSING")
        return record

    def create_content_run(self, value: dict[str, Any]) -> dict[str, Any]:
        value = self._normalize_content_run_strategy_payload(value)
        self._validate_scalar(value)
        self._reject_local_media_paths(value)
        self._assert_content_run_payload_keys(value)
        mode = value.get("executionMode")
        if mode not in _GENERATION_MODES:
            raise StateValidationError("GENERATION_MODE_INVALID")
        generation_profile_id = value.get("generationProfileId")
        if generation_profile_id is not None:
            generation_profile_id = self._text(generation_profile_id, "CONTENT_RUN_PROFILE_MISSING", 128)
        plan_id = self._text(value.get("planId"), "PLAN_ID_INVALID", 128) if value.get("planId") is not None else None
        record = {"id": self._text(value.get("id"), "CONTENT_RUN_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "CONTENT_RUN_CLIENT_MISSING", 128), "brandId": self._text(value.get("brandId"), "CONTENT_RUN_BRAND_MISSING", 128), "identityVersionId": self._text(value.get("identityVersionId"), "CONTENT_RUN_IDENTITY_MISSING", 128), "generationProfileId": generation_profile_id, "executionMode": mode, "recipeId": value.get("recipeId"), "planId": plan_id}
        parent_content_run_id = self._text(value.get("parentContentRunId"), "CONTENT_RUN_PARENT_ID_INVALID", 128) if value.get("parentContentRunId") is not None else None
        if parent_content_run_id == record["id"]:
            raise StateValidationError("CONTENT_RUN_PARENT_ID_INVALID")
        brand = self._row("SELECT client_id, deleted_at FROM brands WHERE id = ?", (record["brandId"],), "CONTENT_RUN_BRAND_MISSING")
        if brand["client_id"] != record["clientId"]:
            raise StateValidationError("CONTENT_RUN_CLIENT_MISMATCH")
        if brand["deleted_at"]:
            raise StateValidationError("BRAND_TRASHED")
        c3_fields = self._content_run_c3_fields(value, record["clientId"], record["brandId"])
        if c3_fields.get("recipeId"):
            record["recipeId"] = c3_fields["recipeId"]
        identity = self._row("SELECT brand_id FROM brand_identities WHERE id = ?", (record["identityVersionId"],), "CONTENT_RUN_IDENTITY_MISSING")
        if identity["brand_id"] != record["brandId"]:
            raise StateValidationError("CONTENT_RUN_IDENTITY_MISMATCH")
        if record["generationProfileId"] is not None:
            profile = self._row("SELECT brand_id, mode FROM generation_profiles WHERE id = ?", (record["generationProfileId"],), "CONTENT_RUN_PROFILE_MISSING")
            if profile["brand_id"] != record["brandId"] or profile["mode"] != record["executionMode"]:
                raise StateValidationError("CONTENT_RUN_PROFILE_MISMATCH")
        if plan_id:
            plan_payload = self._plan_payload(plan_id, record["brandId"])
            scheduled_at = value.get("scheduledAt")
            if scheduled_at is not None:
                if not isinstance(scheduled_at, str):
                    raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
                target_page_id = value.get("targetPageId")
                target_platforms = value.get("targetPlatforms") if isinstance(value.get("targetPlatforms"), list) else []
                binding_ids = value.get("targetBindingIds") or value.get("bindingIds") or []
                targets = []
                if isinstance(binding_ids, list):
                    for binding_id in binding_ids:
                        binding = self.connection.execute("SELECT b.target_external_id, c.platform FROM channel_bindings b JOIN connections c ON c.id = b.connection_id WHERE b.id = ?", (binding_id,)).fetchone()
                        if binding is not None:
                            targets.append((str(binding["target_external_id"]), str(binding["platform"])))
                if isinstance(target_page_id, str):
                    targets = [(target_page_id, str(target_platforms[0]) if target_platforms else "facebook")]
                if not targets:
                    page_ids = plan_payload.get("targetPageIds") if isinstance(plan_payload.get("targetPageIds"), list) else []
                    if page_ids and target_platforms:
                        targets = [(str(page_id), str(platform)) for page_id in page_ids for platform in target_platforms]
                if targets:
                    for page_id, platform in targets:
                        self._validate_plan_schedule(plan_id, record["brandId"], scheduled_at, target_page_id=page_id, platform=platform)
                else:
                    self._validate_plan_schedule(plan_id, record["brandId"], scheduled_at)
        if record["recipeId"] is not None and not isinstance(record["recipeId"], str):
            raise StateValidationError("CONTENT_RUN_RECIPE_INVALID")
        payload = {key: value[key] for key in _CONTENT_RUN_PERSISTED_KEYS if key in value}
        payload.update(c3_fields)
        self._validate_content_run_media_fingerprint(payload)
        if self._content_run_has_media(payload) and "mediaRevision" not in payload:
            payload["mediaRevision"] = 0
        if parent_content_run_id:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                self._validate_content_run_parent_link(record["id"], record["clientId"], record["brandId"], payload)
                self.connection.execute("INSERT INTO content_runs(id, client_id, brand_id, identity_version_id, generation_profile_id, execution_mode, recipe_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], record["identityVersionId"], record["generationProfileId"], record["executionMode"], record["recipeId"], json.dumps(payload, separators=(",", ":"))))
                self.connection.commit()
            except StateValidationError:
                self.connection.rollback()
                raise
            except sqlite3.IntegrityError as error:
                self.connection.rollback()
                raise StateValidationError("CONTENT_RUN_CONFLICT") from error
        else:
            self._insert("INSERT INTO content_runs(id, client_id, brand_id, identity_version_id, generation_profile_id, execution_mode, recipe_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], record["identityVersionId"], record["generationProfileId"], record["executionMode"], record["recipeId"], json.dumps(payload, separators=(",", ":"))), "CONTENT_RUN_CONFLICT")
        return {**{key: value for key, value in record.items() if value is not None}, **payload}

    def mark_provider_attempt(self, content_run_id: str) -> None:
        result = self.connection.execute("UPDATE content_runs SET provider_attempted = 1 WHERE id = ?", (self._text(content_run_id, "CONTENT_RUN_ID_INVALID", 128),))
        self.connection.commit()
        if result.rowcount != 1:
            raise StateValidationError("CONTENT_RUN_MISSING")

    def update_content_run_profile(self, content_run_id: str, generation_profile_id: str, *, _commit: bool = True) -> None:
        try:
            result = self.connection.execute("UPDATE content_runs SET generation_profile_id = ? WHERE id = ?", (self._text(generation_profile_id, "CONTENT_RUN_PROFILE_MISSING", 128), self._text(content_run_id, "CONTENT_RUN_ID_INVALID", 128)))
            if _commit:
                self.connection.commit()
        except sqlite3.IntegrityError as error:
            raise StateValidationError("CONTENT_RUN_PROFILE_IMMUTABLE") from error
        if result.rowcount != 1:
            raise StateValidationError("CONTENT_RUN_MISSING")

    def _plan_payload(self, plan_id: str, brand_id: str) -> dict[str, Any]:
        row = self._row("SELECT brand_id, payload_json FROM automation_plans WHERE id = ?", (plan_id,), "PLAN_MISSING")
        if row["brand_id"] != brand_id:
            raise StateValidationError("PLAN_BRAND_MISMATCH")
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            raise StateValidationError("PLAN_PAYLOAD_INVALID")
        return payload

    def _validate_plan_schedule(self, plan_id: str, brand_id: str, scheduled_at: str, *, target_page_id: str | None = None, platform: str | None = None, validate_run_day: bool = True) -> None:
        plan = self._plan_payload(plan_id, brand_id)
        cron = plan.get("cron") if isinstance(plan.get("cron"), dict) else {}
        timezone_name = cron.get("timezone") or plan.get("timezone")
        if not isinstance(timezone_name, str) or not timezone_name.strip():
            raise StateValidationError("PLAN_TIMEZONE_INVALID")
        try:
            zone = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise StateValidationError("PLAN_TIMEZONE_INVALID") from error
        local = _aware_in_zone(scheduled_at, zone)
        if local is None:
            raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
        for field, failure in (("campaignStartAt", "PLAN_CAMPAIGN_WINDOW_INVALID"), ("campaignEndAt", "PLAN_CAMPAIGN_WINDOW_INVALID")):
            value = plan.get(field)
            if value is None:
                continue
            if not isinstance(value, str):
                raise StateValidationError(failure)
            boundary = _aware_in_zone(value, zone)
            if boundary is None:
                raise StateValidationError(failure)
            if field == "campaignStartAt" and local < boundary or field == "campaignEndAt" and local > boundary:
                raise StateValidationError(failure)
        if target_page_id is None or platform is None:
            return
        page_plans = plan.get("pagePlans") if isinstance(plan.get("pagePlans"), dict) else {}
        page_plan = page_plans.get(target_page_id) if isinstance(page_plans.get(target_page_id), dict) else {}
        schedules = page_plan if isinstance(page_plan, dict) else {}
        schedule = schedules.get(platform)
        if not isinstance(schedule, dict):
            global_plans = plan.get("platforms") if isinstance(plan.get("platforms"), dict) else {}
            schedule = global_plans.get(platform) if isinstance(global_plans.get(platform), dict) else None
        if not isinstance(schedule, dict):
            raise StateValidationError("PLAN_SCHEDULE_MISSING")
        if schedule.get("enabled") is not True:
            raise StateValidationError("PLAN_TARGET_DISABLED")
        if not validate_run_day:
            return
        run_days = schedule.get("runDays", schedule.get("run_days"))
        if not isinstance(run_days, list) or not run_days or any(not isinstance(day, int) or day < 1 or day > 7 for day in run_days):
            raise StateValidationError("PLAN_RUN_DAYS_INVALID")
        if local.isoweekday() not in run_days:
            raise StateValidationError("PLAN_RUN_DAY_INVALID")

    def _slot_conflict_id(self, platform: str, target_external_id: str, scheduled_at: str, exclude_id: str | None = None) -> str | None:
        slot = _utc_iso(scheduled_at)
        terminal_states = ("published", "canceled", "permanent_error", "failed", "blocked", "approval_failed")
        placeholders = ",".join("?" for _ in terminal_states)
        rows = self.connection.execute(f"SELECT id, scheduled_at FROM target_publications WHERE target_platform = ? AND target_external_id = ? AND state NOT IN ({placeholders})", (platform, target_external_id, *terminal_states)).fetchall()
        for row in rows:
            if row["id"] == exclude_id or not row["scheduled_at"]:
                continue
            try:
                if _utc_iso(str(row["scheduled_at"])) == slot:
                    return str(row["id"])
            except StateValidationError:
                continue
        pending = self.connection.execute("SELECT c.publication_id, c.command_json FROM publication_commands c JOIN target_publications p ON p.id = c.publication_id WHERE c.status = 'pending' AND p.target_platform = ? AND p.target_external_id = ?", (platform, target_external_id)).fetchall()
        for row in pending:
            if row["publication_id"] == exclude_id:
                continue
            try:
                command = json.loads(row["command_json"] or "{}")
                pending_at = command.get("scheduledAt")
                if command.get("action") in {"approve", "reschedule", "publish_now"} and isinstance(pending_at, str) and _utc_iso(pending_at) == slot:
                    return str(row["publication_id"])
            except (TypeError, json.JSONDecodeError, StateValidationError):
                continue
        return None

    def _assert_slot_available(self, platform: str, target_external_id: str, scheduled_at: str, exclude_id: str | None = None) -> None:
        if self._slot_conflict_id(platform, target_external_id, scheduled_at, exclude_id):
            raise StateValidationError("TARGET_PUBLICATION_SLOT_CONFLICT")

    def _record_schedule_collisions(self) -> None:
        self.connection.execute("DELETE FROM target_schedule_collision_reports")
        rows = self.connection.execute("SELECT id, target_platform, target_external_id, scheduled_at, state FROM target_publications WHERE scheduled_at IS NOT NULL AND state NOT IN ('published', 'canceled', 'permanent_error', 'failed', 'blocked', 'approval_failed') ORDER BY id").fetchall()
        groups: dict[tuple[str, str, str], list[str]] = {}
        for row in rows:
            if not row["target_platform"] or not row["target_external_id"]:
                continue
            try:
                slot = _utc_iso(str(row["scheduled_at"]))
            except StateValidationError:
                continue
            groups.setdefault((str(row["target_platform"]), str(row["target_external_id"]), slot), []).append(str(row["id"]))
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for (platform, remote_id, slot), publication_ids in groups.items():
            if len(publication_ids) < 2:
                continue
            key = sha256("\x1f".join((platform, remote_id, slot, *publication_ids)).encode("utf-8")).hexdigest()
            self.connection.execute("INSERT INTO target_schedule_collision_reports(conflict_key, target_platform, target_external_id, scheduled_at_utc, publication_ids_json, reported_at) VALUES (?, ?, ?, ?, ?, ?)", (key, platform, remote_id, slot, json.dumps(publication_ids, separators=(",", ":")), now))
        self.connection.commit()

    def list_schedule_collisions(self) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT target_platform, target_external_id, scheduled_at_utc, publication_ids_json, reported_at FROM target_schedule_collision_reports ORDER BY target_platform, target_external_id, scheduled_at_utc").fetchall()
        return [{"targetPlatform": row["target_platform"], "targetExternalId": row["target_external_id"], "scheduledAtUTC": row["scheduled_at_utc"], "publicationIds": json.loads(row["publication_ids_json"]), "reportedAt": row["reported_at"]} for row in rows]

    def update_content_run_payload(self, content_run_id: str, changes: dict[str, Any], *, _commit: bool = True, _transaction_started: bool = False) -> dict[str, Any]:
        changes = self._normalize_content_run_strategy_payload(changes)
        if "expectedRevisionFields" in changes:
            return self.update_content_run_payload_if_revision_matches(content_run_id, changes)
        if changes.get("mediaReplacement") is True and not _transaction_started:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                updated = self.update_content_run_payload(content_run_id, changes, _commit=False, _transaction_started=True)
                if _commit:
                    self.connection.commit()
                return updated
            except Exception:
                self.connection.rollback()
                raise
        self._validate_scalar(changes)
        self._reject_local_media_paths(changes)
        self._assert_content_run_payload_keys(changes)
        content_run_id = self._text(content_run_id, "CONTENT_RUN_ID_INVALID", 128)
        row = self._row("SELECT client_id, brand_id, recipe_id, payload_json FROM content_runs WHERE id = ?", (content_run_id,), "CONTENT_RUN_MISSING")
        try:
            existing = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            existing = {}
        if not isinstance(existing, dict):
            existing = {}
        existing = self._normalize_content_run_media_revision_aliases(existing)
        immutable_copy_fields = {"topic", "caption", "body", "prompt", "variants", "mediaAssetIds", "mediaEvidence", "providerTraceId", "requestId", "revisionId", "parentRevisionId", "parentContentRunId", "revisionHistory", "contentIntelligenceLineage", "selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "promptBlueprintVersion", "selectedRecipeId", "recipeId", "transformMode", "mediaSetFingerprint", "customerFacts", "contentAngle", "strategyVersion", "catalogFingerprint", "strategySnapshot", "strategyState", "regenerationState"}
        media_replacement_requested = changes.get("mediaReplacement") is True
        existing_locked = self._content_run_is_locked(content_run_id, existing)
        if existing_locked and self._content_run_media_operation_checkpoint_requested(changes):
            raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
        if existing_locked and self._content_run_target_approval_metadata_requested(changes) and not self._content_run_target_approval_metadata_is_acknowledged(content_run_id, existing, changes):
            raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
        media_replacement = media_replacement_requested \
            and changes.get("state") == "needs_review" \
            and changes.get("qualityStatus") == "pending" \
            and changes.get("approvalState") == "pending" \
            and isinstance(changes.get("mediaAssetIds"), list) \
            and isinstance(changes.get("mediaEvidence"), list) \
            and isinstance(changes.get("mediaSetFingerprint"), str) \
            and isinstance(changes.get("contentIntelligenceLineage"), dict) \
            and not existing_locked
        if media_replacement_requested and existing_locked:
            raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
        if media_replacement_requested and not media_replacement:
            raise StateValidationError("CONTENT_RUN_MEDIA_REPLACEMENT_INVALID")
        if immutable_copy_fields.intersection(changes) and existing_locked and not media_replacement:
            raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
        c3_fields = self._content_run_c3_fields(changes, str(row["client_id"]), str(row["brand_id"]), existing)
        incoming_lineage = c3_fields.get("contentIntelligenceLineage") if isinstance(c3_fields.get("contentIntelligenceLineage"), dict) else None
        existing_lineage = existing.get("contentIntelligenceLineage") if isinstance(existing.get("contentIntelligenceLineage"), dict) else None
        if media_replacement:
            replacement_ids = changes.get("mediaAssetIds")
            replacement_evidence = c3_fields.get("mediaEvidence")
            expected_ids = [item.get("assetId") for item in replacement_evidence] if isinstance(replacement_evidence, list) else []
            if not isinstance(existing_lineage, dict) or not isinstance(incoming_lineage, dict):
                raise StateValidationError("CONTENT_RUN_LINEAGE_IMMUTABLE")
            if not isinstance(replacement_ids, list) or not replacement_ids or any(not isinstance(item, str) or not item.strip() for item in replacement_ids) or len(set(replacement_ids)) != len(replacement_ids) or replacement_ids != expected_ids:
                raise StateValidationError("CONTENT_RUN_MEDIA_REPLACEMENT_IDS_INVALID")
            without_media = lambda value: {key: item for key, item in value.items() if key != "mediaSetFingerprint"}
            if without_media(incoming_lineage) != without_media(existing_lineage):
                raise StateValidationError("CONTENT_RUN_LINEAGE_IMMUTABLE")
        if incoming_lineage is not None and (existing.get("mediaEvidence") or changes.get("mediaEvidence")) and not incoming_lineage.get("mediaSetFingerprint"):
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        if existing.get("contentIntelligenceLineage") is not None and _CONTENT_RUN_LINEAGE_KEYS.intersection(changes):
            if c3_fields.get("contentIntelligenceLineage") != existing.get("contentIntelligenceLineage") and not media_replacement:
                raise StateValidationError("CONTENT_RUN_LINEAGE_IMMUTABLE")
        if existing_lineage is not None and "prompt" in changes and changes.get("prompt") != existing.get("prompt"):
            raise StateValidationError("CONTENT_RUN_LINEAGE_IMMUTABLE")
        if existing_lineage is not None and str(row["recipe_id"] or "") != str(existing_lineage.get("selectedRecipeId") or ""):
            raise StateValidationError("CONTENT_RUN_LINEAGE_ALIAS_MISMATCH")
        if incoming_lineage is not None and str(row["recipe_id"] or "") != str(incoming_lineage.get("selectedRecipeId") or ""):
            raise StateValidationError("CONTENT_RUN_LINEAGE_ALIAS_MISMATCH")
        if "mediaRevision" in c3_fields and not media_replacement and "mediaRevision" in existing and c3_fields["mediaRevision"] != existing["mediaRevision"]:
            raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_IMMUTABLE")
        payload = {key: value for key, value in changes.items() if key in _CONTENT_RUN_PERSISTED_KEYS and key not in {"generationProfileId", "expectedRevisionFields"}}
        payload.update(c3_fields)
        if media_replacement:
            for key in ("qualityChecks", "quality_checks", "checkedAt", "checked_at", "approvalState", "approval_state", "targetApprovalState", "target_approval_state", "targetApprovalIntents", "target_approval_intents"):
                existing.pop(key, None)
            payload.update({"qualityChecks": [], "checkedAt": None, "approvalState": "pending", "targetApprovalState": "pending", "targetApprovalIntents": []})
            current_media_revision = existing.get("mediaRevision", 0)
            if not isinstance(current_media_revision, int) or isinstance(current_media_revision, bool) or current_media_revision < 0:
                raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_INVALID")
            if self._content_run_has_media(existing) and "mediaRevision" not in c3_fields:
                raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_REQUIRED")
            if "mediaRevision" in c3_fields and c3_fields["mediaRevision"] != current_media_revision:
                raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_MISMATCH")
            existing_variants = existing.get("variants")
            replacement_ids = payload.get("mediaAssetIds")
            replacement_evidence = c3_fields.get("mediaEvidence")
            replacement_fingerprint = c3_fields.get("mediaSetFingerprint")
            if not isinstance(existing_variants, list) or not existing_variants or not isinstance(replacement_ids, list) or not isinstance(replacement_evidence, list) or not isinstance(replacement_fingerprint, str):
                raise StateValidationError("CONTENT_RUN_MEDIA_VARIANTS_MISSING")
            updated_variants = []
            for variant in existing_variants:
                if not isinstance(variant, dict):
                    raise StateValidationError("CONTENT_RUN_MEDIA_VARIANTS_INVALID")
                variant_copy = dict(variant)
                metadata = variant_copy.get("metadata")
                metadata_copy = dict(metadata) if isinstance(metadata, dict) else {}
                variant_copy["mediaAssetIds"] = list(replacement_ids)
                variant_copy["mediaSetFingerprint"] = replacement_fingerprint
                if "mediaEvidence" in variant_copy:
                    variant_copy["mediaEvidence"] = [dict(item) for item in replacement_evidence]
                metadata_copy["mediaEvidence"] = [dict(item) for item in replacement_evidence]
                metadata_copy["mediaSetFingerprint"] = replacement_fingerprint
                if "mediaAssetIds" in metadata_copy:
                    metadata_copy["mediaAssetIds"] = list(replacement_ids)
                for container in (variant_copy, metadata_copy):
                    lineage_copy = container.get("contentIntelligenceLineage")
                    if isinstance(lineage_copy, dict) and "mediaSetFingerprint" in lineage_copy:
                        container["contentIntelligenceLineage"] = {**lineage_copy, "mediaSetFingerprint": replacement_fingerprint}
                variant_copy["metadata"] = metadata_copy
                updated_variants.append(variant_copy)
            payload["variants"] = updated_variants
            payload["mediaRevision"] = current_media_revision + 1
        effective_payload = {**existing, **payload}
        self._validate_content_run_parent_link(content_run_id, str(row["client_id"]), str(row["brand_id"]), effective_payload, existing, changes)
        self._validate_content_run_media_fingerprint(effective_payload, None if media_replacement else existing)
        if not _transaction_started:
            try:
                # Re-run the authority read/check/merge while holding the write reservation.
                self.connection.execute("BEGIN IMMEDIATE")
                updated = self.update_content_run_payload(content_run_id, changes, _commit=False, _transaction_started=True)
                if _commit:
                    self.connection.commit()
                return updated
            except Exception:
                self.connection.rollback()
                raise
        profile_id = changes.get("generationProfileId")
        if profile_id is not None:
            if not isinstance(profile_id, str):
                raise StateValidationError("CONTENT_RUN_PROFILE_MISSING")
            self.update_content_run_profile(content_run_id, profile_id, _commit=_commit)
        self.connection.execute("UPDATE content_runs SET payload_json = ? WHERE id = ?", (json.dumps({**existing, **payload}, separators=(",", ":")), content_run_id))
        if _commit:
            self.connection.commit()
        return self.list_entity("content_runs", content_run_id)[0]

    def update_content_run_payload_if_revision_matches(self, content_run_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        changes = self._normalize_content_run_strategy_payload(changes)
        self._validate_scalar(changes)
        self._reject_local_media_paths(changes)
        self._assert_content_run_payload_keys(changes)
        content_run_id = self._text(content_run_id, "CONTENT_RUN_ID_INVALID", 128)
        expected = changes.get("expectedRevisionFields")
        legacy_expected_keys = {"clientId", "brandId", "identityVersionId", "revisionId", "topic", "body", "caption", "contentPillar", "objective", "cta", "hashtags", "seoKeywords", "scheduledAt", "sources", "notes", "variantId", "variant"}
        strategy_expected_keys = {"contentAngle", "strategyVersion", "catalogFingerprint", "strategySnapshot", "strategyState", "regenerationState"}
        expected_keys = legacy_expected_keys | strategy_expected_keys
        legacy_variant_keys = {"title", "body", "caption", "cta", "hashtags", "seoKeywords", "mediaAssetIds", "mediaOperations", "mediaEvidence"}
        strategy_variant_keys = {"contentPillar", "contentAngle", "objective", "strategyVersion", "catalogFingerprint", "strategySnapshot"}
        variant_keys = legacy_variant_keys | strategy_variant_keys
        if not isinstance(expected, dict) or set(expected) not in (legacy_expected_keys, expected_keys) or not isinstance(expected.get("variant"), dict) or set(expected["variant"]) not in (legacy_variant_keys, variant_keys):
            raise StateValidationError("CONTENT_RUN_REVISION_FINGERPRINT_INVALID")
        variant_id = self._text(expected.get("variantId"), "CONTENT_RUN_REVISION_FINGERPRINT_INVALID", 256)

        # Hold the SQLite write reservation across compare and merge so a concurrent edit cannot land between them.
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            row = self._row("SELECT client_id, brand_id, identity_version_id, payload_json FROM content_runs WHERE id = ?", (content_run_id,), "CONTENT_RUN_MISSING")
            try:
                existing = json.loads(row["payload_json"] or "{}")
            except json.JSONDecodeError:
                existing = {}
            if not isinstance(existing, dict):
                existing = {}
            if self._content_run_is_locked(content_run_id, existing) and self._content_run_media_operation_checkpoint_requested(changes):
                raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
            if self._content_run_is_locked(content_run_id, existing) and self._content_run_target_approval_metadata_requested(changes) and not self._content_run_target_approval_metadata_is_acknowledged(content_run_id, existing, changes):
                raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
            variants = existing.get("variants") if isinstance(existing.get("variants"), list) else []
            variant = next((item for item in variants if isinstance(item, dict) and item.get("id") == variant_id), None)
            if variant is None:
                raise StateValidationError("CONTENT_RUN_REVISION_MISMATCH")
            root_keys = expected_keys if strategy_expected_keys.issubset(set(expected)) else legacy_expected_keys
            actual_root = {
                "clientId": row["client_id"],
                "brandId": row["brand_id"],
                "identityVersionId": row["identity_version_id"],
                **{key: existing.get(key) for key in root_keys if key not in {"clientId", "brandId", "identityVersionId", "variantId", "variant"}},
            }
            metadata = variant.get("metadata") if isinstance(variant.get("metadata"), dict) else {}
            actual_variant = {
                "title": variant.get("title"),
                "body": variant.get("body"),
                "caption": variant.get("caption"),
                "cta": variant.get("cta"),
                "hashtags": variant.get("hashtags") or [],
                "seoKeywords": variant.get("seoKeywords") or [],
                "mediaAssetIds": variant.get("mediaAssetIds") or [],
                "mediaOperations": variant.get("mediaOperations") or [],
                "mediaEvidence": metadata.get("mediaEvidence") or [],
            }
            if strategy_variant_keys.issubset(set(expected["variant"])):
                actual_variant.update({key: variant.get(key) for key in strategy_variant_keys})
            expected_root = {key: value for key, value in expected.items() if key not in {"variantId", "variant"}}
            if actual_root != expected_root or actual_variant != expected["variant"]:
                raise StateValidationError("CONTENT_RUN_REVISION_MISMATCH")
            if self._content_run_is_locked(content_run_id, existing):
                raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
            quality_status = changes.get("qualityStatus")
            quality_checks = changes.get("qualityChecks")
            checked_at = changes.get("checkedAt")
            state = changes.get("state")
            if quality_status not in {"passed", "failed"} or state not in {"ready", "needs_review"} or not isinstance(quality_checks, list) or not quality_checks or not isinstance(checked_at, str) or not checked_at.strip():
                raise StateValidationError("CONTENT_RUN_QUALITY_RESULT_INVALID")
            if any(not isinstance(check, dict) or not isinstance(check.get("key"), str) or not isinstance(check.get("passed"), bool) for check in quality_checks):
                raise StateValidationError("CONTENT_RUN_QUALITY_RESULT_INVALID")
            actual_status = "passed" if all(check["passed"] for check in quality_checks) else "failed"
            expected_state = "ready" if quality_status == "passed" else "needs_review"
            if quality_status != actual_status or state != expected_state:
                raise StateValidationError("CONTENT_RUN_QUALITY_RESULT_INVALID")
            update = {
                "state": state,
                "qualityStatus": quality_status,
                "qualityChecks": quality_checks,
                "checkedAt": checked_at,
                "approvalState": "pending",
            }
            updated = self.update_content_run_payload(content_run_id, update, _commit=False, _transaction_started=True)
            self.connection.commit()
            return updated
        except Exception:
            if self.connection.in_transaction:
                self.connection.rollback()
            raise

    @staticmethod
    def _content_run_media_value_present(value: Any) -> bool:
        if isinstance(value, (list, dict)):
            return bool(value)
        if isinstance(value, str):
            return bool(value.strip())
        return value is not None

    @classmethod
    def _content_run_has_media(cls, value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        if cls._content_run_media_value_present(value.get("mediaEvidence")) or cls._content_run_media_value_present(value.get("mediaAssetIds")):
            return True
        variants = value.get("variants")
        if not isinstance(variants, list):
            return False
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            if cls._content_run_media_value_present(variant.get("mediaEvidence")) or cls._content_run_media_value_present(variant.get("mediaAssetIds")):
                return True
            metadata = variant.get("metadata")
            if isinstance(metadata, dict) and any(cls._content_run_media_value_present(metadata.get(key)) for key in _CONTENT_RUN_MEDIA_METADATA_KEYS):
                return True
        return False

    @staticmethod
    def _content_run_media_operation_checkpoint_requested(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        media_checkpoint_keys = {
            "mediaEvidence", "mediaAssetIds", "mediaOperations", "visualOperations",
            "mediaUrl", "imageUrl", "videoUrl", "publicUrl", "mediaSha256",
            "visualFingerprint", "mediaProvenance", "mediaSetFingerprint", "mediaRevision",
            "mediaReplacement", "variants", "generationStatus", "rewriteStatus", "rewriteError",
            "contentKind", "mediaKind", "qualityChecks", "qualityStatus", "checkedAt",
        }
        return bool(media_checkpoint_keys.intersection(value))

    @staticmethod
    def _content_run_target_approval_metadata_requested(value: Any) -> bool:
        return isinstance(value, dict) and bool({"targetApprovalState", "targetApprovalIntents"}.intersection(value))

    def _content_run_target_approval_metadata_is_acknowledged(self, content_run_id: str, existing_payload: dict[str, Any], changes: dict[str, Any]) -> bool:
        if changes.get("state") != "scheduled" or changes.get("approvalState") != "approved" or changes.get("targetApprovalState") != "acknowledged":
            return False
        intents = changes.get("targetApprovalIntents", existing_payload.get("targetApprovalIntents", existing_payload.get("target_approval_intents")))
        if not isinstance(intents, list) or not intents:
            return False
        rows = self.connection.execute(
            "SELECT id, binding_id, variant_id, client_id, brand_id, content_run_id, state, pending_command_id, worker_ack_state FROM target_publications WHERE content_run_id = ?",
            (content_run_id,),
        ).fetchall()
        active = [row for row in rows if row["state"] not in _TERMINAL_PUBLICATION_STATES]
        if not active or len(intents) != len(active) or {str(item.get("id")) for item in intents if isinstance(item, dict)} != {str(row["id"]) for row in active}:
            return False
        for item in intents:
            if not isinstance(item, dict):
                return False
            row = next((candidate for candidate in active if str(candidate["id"]) == str(item.get("id"))), None)
            if row is None or row["state"] != "scheduled" or row["pending_command_id"] is not None or row["worker_ack_state"] not in {"not_required", "acknowledged", "confirmed", "accepted"}:
                return False
            if any(str(item.get(key)) != str(row[row_key]) for key, row_key in (("bindingId", "binding_id"), ("variantId", "variant_id"), ("clientId", "client_id"), ("brandId", "brand_id"), ("contentRunId", "content_run_id")) if key in item):
                return False
        return True

    @staticmethod
    def _content_run_media_fingerprint_values(value: Any) -> list[Any]:
        values: list[Any] = []

        def collect(container: Any) -> None:
            if not isinstance(container, dict):
                return
            if "mediaSetFingerprint" in container:
                values.append(container["mediaSetFingerprint"])
            lineage = container.get("contentIntelligenceLineage")
            if isinstance(lineage, dict) and "mediaSetFingerprint" in lineage:
                values.append(lineage["mediaSetFingerprint"])

        collect(value)
        if isinstance(value, dict) and isinstance(value.get("variants"), list):
            for variant in value["variants"]:
                if not isinstance(variant, dict):
                    continue
                collect(variant)
                collect(variant.get("metadata"))
        return [item for item in values if item is not None]

    def _validate_content_run_media_fingerprint(self, payload: dict[str, Any], existing_payload: dict[str, Any] | None = None) -> None:
        has_media = self._content_run_has_media(payload)
        existing_has_media = self._content_run_has_media(existing_payload) if existing_payload is not None else False
        if existing_has_media and not has_media:
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        if not has_media:
            return
        values = self._content_run_media_fingerprint_values(payload)
        if not values or any(not isinstance(value, str) or re.fullmatch(r"[a-fA-F0-9]{64}", value) is None for value in values):
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        fingerprint = values[0].lower()
        if any(value.lower() != fingerprint for value in values):
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        if existing_has_media and isinstance(existing_payload, dict) and existing_payload.get("contentIntelligenceLineage") is not None:
            existing_values = self._content_run_media_fingerprint_values(existing_payload)
            if not existing_values or any(not isinstance(value, str) or re.fullmatch(r"[a-fA-F0-9]{64}", value) is None or value.lower() != fingerprint for value in existing_values):
                raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")

    def _validate_content_run_parent_link(self, content_run_id: str, client_id: str, brand_id: str, effective_payload: dict[str, Any], existing_payload: dict[str, Any] | None = None, submitted_payload: dict[str, Any] | None = None) -> None:
        parent_content_run_id = effective_payload.get("parentContentRunId")
        if parent_content_run_id is None:
            return
        parent_content_run_id = self._text(parent_content_run_id, "CONTENT_RUN_PARENT_ID_INVALID", 128)
        if parent_content_run_id == content_run_id:
            raise StateValidationError("CONTENT_RUN_PARENT_ID_INVALID")
        parent = self.connection.execute("SELECT client_id, brand_id, payload_json FROM content_runs WHERE id = ?", (parent_content_run_id,)).fetchone()
        if parent is None:
            raise StateValidationError("CONTENT_RUN_PARENT_MISSING")
        if parent["client_id"] != client_id or parent["brand_id"] != brand_id:
            raise StateValidationError("CONTENT_RUN_PARENT_SCOPE_MISMATCH")
        if existing_payload is not None and "parentContentRunId" in (submitted_payload or {}):
            if "parentRevisionId" not in (submitted_payload or {}):
                raise StateValidationError("CONTENT_RUN_PARENT_REVISION_REQUIRED")
            if "revisionId" not in (submitted_payload or {}):
                raise StateValidationError("CONTENT_RUN_REVISION_ID_INVALID")
        try:
            parent_payload = json.loads(parent["payload_json"] or "{}")
        except json.JSONDecodeError:
            parent_payload = {}
        if not isinstance(parent_payload, dict):
            parent_payload = {}
        parent_lineage = parent_payload.get("contentIntelligenceLineage")
        child_lineage = effective_payload.get("contentIntelligenceLineage")
        if (parent_lineage is None) != (child_lineage is None) or parent_lineage != child_lineage:
            raise StateValidationError("CONTENT_RUN_PARENT_LINEAGE_MISMATCH")
        if parent_payload.get("planId") != effective_payload.get("planId"):
            raise StateValidationError("CONTENT_RUN_PARENT_PLAN_MISMATCH")
        if parent_payload.get("generationStatus") in {"pending", "unknown"}:
            raise StateValidationError("CONTENT_RUN_RECONCILIATION_REQUIRED")
        if parent_payload.get("state") in {"scheduled", "publishing", "published"} or parent_payload.get("approvalState") in {"approved", "scheduled", "publishing", "published"} or self._content_run_has_active_publication(parent_content_run_id) or self._content_run_has_provider_confirmed_publication(parent_content_run_id):
            raise StateValidationError("CONTENT_RUN_REVISION_IMMUTABLE")
        parent_revision_id = effective_payload.get("parentRevisionId")
        if not isinstance(parent_revision_id, str) or not parent_revision_id.strip():
            raise StateValidationError("CONTENT_RUN_PARENT_REVISION_REQUIRED")
        revision_id = effective_payload.get("revisionId")
        if not isinstance(revision_id, str) or not revision_id.strip():
            raise StateValidationError("CONTENT_RUN_REVISION_ID_INVALID")
        allowed_parent_revisions = set()
        if isinstance(parent_payload.get("revisionId"), str) and parent_payload["revisionId"].strip():
            allowed_parent_revisions.add(parent_payload["revisionId"].strip())
        if isinstance(parent_payload.get("revisionHistory"), list):
            allowed_parent_revisions.update(item["id"].strip() for item in parent_payload["revisionHistory"] if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip())
        if parent_revision_id.strip() not in allowed_parent_revisions:
            raise StateValidationError("CONTENT_RUN_PARENT_REVISION_MISMATCH")
        if existing_payload is not None and existing_payload.get("parentContentRunId") is not None:
            if any(effective_payload.get(key) != existing_payload.get(key) for key in ("parentContentRunId", "parentRevisionId", "revisionId")):
                raise StateValidationError("CONTENT_RUN_PARENT_LINK_IMMUTABLE")

    @staticmethod
    def _normalize_content_run_media_revision_aliases(value: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(value)
        aliases = ("mediaRevision", "media_revision", "contentRunRevision", "content_run_revision")
        present = [value[key] for key in aliases if key in value]
        if not present:
            return normalized
        if any(not isinstance(revision, int) or isinstance(revision, bool) or revision < 0 for revision in present):
            raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_INVALID")
        if any(revision != present[0] for revision in present[1:]):
            raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_ALIAS_MISMATCH")
        for alias in aliases:
            normalized.pop(alias, None)
        normalized["mediaRevision"] = present[0]
        return normalized

    @staticmethod
    def _normalize_content_run_strategy_payload(value: dict[str, Any]) -> dict[str, Any]:
        normalized = AgencyStateStore._normalize_content_run_media_revision_aliases(value)
        for alias, canonical in _CONTENT_RUN_STRATEGY_ALIASES.items():
            if alias not in value:
                continue
            if canonical in value and value[canonical] != value[alias]:
                raise StateValidationError("CONTENT_RUN_STRATEGY_ALIAS_MISMATCH")
            normalized[canonical] = value[alias]
            normalized.pop(alias, None)
        snapshot = normalized.get("strategySnapshot")
        if isinstance(snapshot, dict):
            snapshot_copy = dict(snapshot)
            for alias, canonical in (("objective_key", "objectiveKey"), ("objective_label", "objectiveLabel"), ("pillar_id", "pillarId"), ("pillar_label", "pillarLabel"), ("angle_id", "angleId"), ("angle_label", "angleLabel"), ("angle_guidance", "angleGuidance"), ("angle_id_by_channel", "angleIdByChannel"), ("strategy_version", "strategyVersion"), ("catalog_fingerprint", "catalogFingerprint"), ("recipe_id", "recipeId"), ("recipe_guidance", "recipeGuidance")):
                if alias in snapshot:
                    if canonical in snapshot and snapshot[canonical] != snapshot[alias]:
                        raise StateValidationError("CONTENT_RUN_STRATEGY_ALIAS_MISMATCH")
                    snapshot_copy[canonical] = snapshot[alias]
                    snapshot_copy.pop(alias, None)
            normalized["strategySnapshot"] = snapshot_copy
        expected = normalized.get("expectedRevisionFields")
        if isinstance(expected, dict):
            normalized["expectedRevisionFields"] = AgencyStateStore._normalize_content_run_strategy_payload(expected)
        variant = normalized.get("variant")
        if isinstance(variant, dict):
            normalized["variant"] = AgencyStateStore._normalize_content_run_strategy_payload(variant)
        return normalized

    @staticmethod
    def _valid_content_run_strategy_snapshot(snapshot: Any) -> bool:
        if not isinstance(snapshot, dict) or not set(snapshot).issubset(_CONTENT_RUN_STRATEGY_SNAPSHOT_KEYS):
            return False
        required = ("objectiveKey", "objectiveLabel", "pillarId", "pillarLabel", "angleId", "angleLabel", "angleGuidance", "channel", "format", "strategyVersion", "catalogFingerprint")
        if any(key not in snapshot for key in required):
            return False
        if snapshot["objectiveKey"] not in _STRATEGY_OBJECTIVE_KEYS or not _strategy_valid_text(snapshot["objectiveLabel"], _STRATEGY_MAX_LABEL):
            return False
        if not _strategy_is_kebab(snapshot["pillarId"]) or not _strategy_valid_text(snapshot["pillarLabel"], _STRATEGY_MAX_LABEL):
            return False
        if not _strategy_is_kebab(snapshot["angleId"]) or not _strategy_valid_text(snapshot["angleLabel"], _STRATEGY_MAX_LABEL) or not _strategy_valid_text(snapshot["angleGuidance"], _STRATEGY_MAX_GUIDANCE):
            return False
        if snapshot["channel"] not in _STRATEGY_CHANNELS or snapshot["format"] not in _CONTENT_RUN_STRATEGY_FORMATS:
            return False
        if not isinstance(snapshot["strategyVersion"], int) or isinstance(snapshot["strategyVersion"], bool) or snapshot["strategyVersion"] < 1:
            return False
        if not isinstance(snapshot["catalogFingerprint"], str) or re.fullmatch(r"[a-fA-F0-9]{64}", snapshot["catalogFingerprint"]) is None:
            return False
        recipe_id = snapshot.get("recipeId")
        if recipe_id is not None and not _strategy_is_kebab(recipe_id):
            return False
        recipe_guidance = snapshot.get("recipeGuidance")
        if recipe_guidance is not None and not _strategy_valid_text(recipe_guidance, _STRATEGY_MAX_GUIDANCE):
            return False
        angle_map = snapshot.get("angleIdByChannel")
        if angle_map is not None and (not isinstance(angle_map, dict) or any(channel not in _STRATEGY_CHANNELS or not _strategy_is_kebab(angle_id) for channel, angle_id in angle_map.items())):
            return False
        return True

    def _content_run_strategy_fields(self, value: dict[str, Any], existing_payload: dict[str, Any] | None = None) -> dict[str, Any]:
        source = {**(existing_payload or {}), **value}
        present = _CONTENT_RUN_STRATEGY_KEYS.intersection(source)
        if not present:
            return {}
        snapshot = source.get("strategySnapshot")
        if not self._valid_content_run_strategy_snapshot(snapshot):
            raise StateValidationError("CONTENT_RUN_STRATEGY_INVALID")
        snapshot = dict(snapshot)
        snapshot["catalogFingerprint"] = str(snapshot["catalogFingerprint"]).lower()
        angle = source.get("contentAngle")
        if not isinstance(angle, str) or not angle.strip() or len(angle.strip()) > _STRATEGY_MAX_LABEL or _STRATEGY_SECRET_VALUE.search(angle):
            raise StateValidationError("CONTENT_RUN_STRATEGY_INVALID")
        version = source.get("strategyVersion")
        fingerprint = source.get("catalogFingerprint")
        if not isinstance(version, int) or isinstance(version, bool) or version < 1 or version != snapshot["strategyVersion"]:
            raise StateValidationError("CONTENT_RUN_STRATEGY_VERSION_MISMATCH")
        if not isinstance(fingerprint, str) or re.fullmatch(r"[a-fA-F0-9]{64}", fingerprint) is None or fingerprint.lower() != snapshot["catalogFingerprint"]:
            raise StateValidationError("CONTENT_RUN_STRATEGY_FINGERPRINT_MISMATCH")
        strategy_state = source.get("strategyState", source.get("regenerationState"))
        regeneration_state = source.get("regenerationState", source.get("strategyState"))
        if strategy_state not in _CONTENT_RUN_STRATEGY_STATES or regeneration_state not in _CONTENT_RUN_STRATEGY_STATES or strategy_state != regeneration_state:
            raise StateValidationError("CONTENT_RUN_STRATEGY_STATE_INVALID")
        if strategy_state == "clean" and angle.strip().lower() not in {snapshot["angleId"].lower(), snapshot["angleLabel"].lower()}:
            raise StateValidationError("CONTENT_RUN_STRATEGY_ANGLE_MISMATCH")
        return {"contentAngle": angle.strip(), "strategyVersion": version, "catalogFingerprint": fingerprint.lower(), "strategySnapshot": snapshot, "strategyState": strategy_state, "regenerationState": regeneration_state}

    def _content_run_c3_fields(self, value: dict[str, Any], client_id: str, brand_id: str, existing_payload: dict[str, Any] | None = None) -> dict[str, Any]:
        fields = {}
        if "requestId" in value:
            fields["requestId"] = self._text(value["requestId"], "CONTENT_RUN_REQUEST_ID_INVALID", 128)
        if "promptVersion" in value:
            fields["promptVersion"] = self._text(value["promptVersion"], "CONTENT_RUN_PROMPT_VERSION_INVALID", 128)
        if "mediaSetFingerprint" in value:
            fingerprint = value["mediaSetFingerprint"]
            if not isinstance(fingerprint, str) or re.fullmatch(r"[a-fA-F0-9]{64}", fingerprint) is None:
                raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
            fields["mediaSetFingerprint"] = fingerprint.lower()
        if "mediaRevision" in value:
            revision = value["mediaRevision"]
            if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
                raise StateValidationError("CONTENT_RUN_MEDIA_REVISION_INVALID")
            fields["mediaRevision"] = revision
        if "generationStatus" in value:
            status = value["generationStatus"]
            if not isinstance(status, str) or status not in _CONTENT_RUN_GENERATION_STATUSES:
                raise StateValidationError("CONTENT_RUN_GENERATION_STATUS_INVALID")
            fields["generationStatus"] = status
        if "mediaEvidence" in value:
            fields["mediaEvidence"] = self._content_run_media_evidence(value["mediaEvidence"], client_id, brand_id)
        fields.update(self._content_run_lineage_fields(value))
        fields.update(self._content_run_revision_fields(value))
        fields.update(self._content_run_strategy_fields(value, existing_payload))
        return fields

    def _content_run_lineage_fields(self, value: dict[str, Any]) -> dict[str, Any]:
        lineage_keys = {"contentIntelligenceLineage", "selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "promptBlueprintVersion", "selectedRecipeId", "customerFacts"}
        if not lineage_keys.intersection(value):
            return {}
        raw = value.get("contentIntelligenceLineage")
        if raw is not None and (not isinstance(raw, dict) or any(key not in {"selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedPromptBlueprintVersion", "selectedRecipeId", "transformMode", "mediaSetFingerprint", "customerFacts"} for key in raw)):
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")
        source = raw if isinstance(raw, dict) else value
        if not isinstance(value.get("prompt"), str) or not value["prompt"].strip():
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")
        required_lineage_fields = {"selectedKnowledgeItemIds", "selectedResearchEvidenceIds", "selectedPromptBlueprintId", "selectedRecipeId", "transformMode", "customerFacts"}
        if any(field not in source for field in required_lineage_fields):
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")

        def string_list(key: str, code: str, maximum: int = 100) -> list[str]:
            items = source.get(key)
            if not isinstance(items, list) or len(items) > maximum or any(not isinstance(item, str) or not item.strip() or len(item.strip()) > 256 for item in items):
                raise StateValidationError(code)
            normalized = [item.strip() for item in items]
            if len(normalized) != len(set(normalized)):
                raise StateValidationError(code)
            return normalized

        knowledge_ids = string_list("selectedKnowledgeItemIds", "CONTENT_RUN_LINEAGE_INVALID")
        evidence_ids = string_list("selectedResearchEvidenceIds", "CONTENT_RUN_LINEAGE_INVALID")
        blueprint_id = source.get("selectedPromptBlueprintId", value.get("selectedPromptBlueprintId", ""))
        recipe_id = source.get("selectedRecipeId", value.get("selectedRecipeId", value.get("recipeId", "")))
        if not isinstance(blueprint_id, str) or not blueprint_id.strip() or len(blueprint_id.strip()) > 128 or not isinstance(recipe_id, str) or not recipe_id.strip() or len(recipe_id.strip()) > 128:
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")
        blueprint_version = source.get("selectedPromptBlueprintVersion", source.get("promptBlueprintVersion", value.get("selectedPromptBlueprintVersion", value.get("promptBlueprintVersion"))))
        if not isinstance(blueprint_version, int) or blueprint_version < 1:
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")
        transform = source.get("transformMode", value.get("transformMode", "original"))
        if transform not in _CONTENT_RUN_TRANSFORM_MODES:
            raise StateValidationError("CONTENT_RUN_LINEAGE_INVALID")
        fingerprint = source.get("mediaSetFingerprint", value.get("mediaSetFingerprint"))
        if fingerprint is not None and (not isinstance(fingerprint, str) or re.fullmatch(r"[a-fA-F0-9]{64}", fingerprint) is None):
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        customer_facts = string_list("customerFacts", "CONTENT_RUN_LINEAGE_INVALID", 50)
        if isinstance(value.get("mediaEvidence"), list) and value["mediaEvidence"] and not fingerprint:
            raise StateValidationError("CONTENT_RUN_MEDIA_SET_FINGERPRINT_INVALID")
        lineage = {
            "selectedKnowledgeItemIds": knowledge_ids,
            "selectedResearchEvidenceIds": evidence_ids,
            "selectedPromptBlueprintId": blueprint_id.strip(),
            "selectedPromptBlueprintVersion": blueprint_version,
            "selectedRecipeId": recipe_id.strip(),
            "transformMode": transform,
            **({"mediaSetFingerprint": fingerprint.lower()} if fingerprint else {}),
            "customerFacts": customer_facts,
        }
        aliases = {
            "selectedKnowledgeItemIds": lineage["selectedKnowledgeItemIds"],
            "selectedResearchEvidenceIds": lineage["selectedResearchEvidenceIds"],
            "selectedPromptBlueprintId": lineage["selectedPromptBlueprintId"],
            "selectedPromptBlueprintVersion": lineage.get("selectedPromptBlueprintVersion"),
            "promptBlueprintVersion": lineage.get("selectedPromptBlueprintVersion"),
            "selectedRecipeId": lineage["selectedRecipeId"],
            "recipeId": lineage["selectedRecipeId"],
            "transformMode": lineage["transformMode"],
            "mediaSetFingerprint": lineage.get("mediaSetFingerprint"),
            "customerFacts": lineage["customerFacts"],
        }
        for key, expected in aliases.items():
            if key in value and value[key] != expected:
                raise StateValidationError("CONTENT_RUN_LINEAGE_ALIAS_MISMATCH")
        fields = {"contentIntelligenceLineage": lineage, "selectedKnowledgeItemIds": knowledge_ids, "selectedResearchEvidenceIds": evidence_ids, "selectedPromptBlueprintId": lineage["selectedPromptBlueprintId"], "selectedRecipeId": lineage["selectedRecipeId"], "transformMode": transform, "customerFacts": customer_facts}
        fields["selectedPromptBlueprintVersion"] = blueprint_version
        fields["promptBlueprintVersion"] = blueprint_version
        if fingerprint:
            fields["mediaSetFingerprint"] = fingerprint.lower()
        if lineage["selectedRecipeId"] and not value.get("recipeId"):
            fields["recipeId"] = lineage["selectedRecipeId"]
        return fields

    def _content_run_revision_fields(self, value: dict[str, Any]) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        for key, code in (("revisionId", "CONTENT_RUN_REVISION_ID_INVALID"), ("parentRevisionId", "CONTENT_RUN_PARENT_REVISION_ID_INVALID")):
            if key in value:
                fields[key] = self._text(value[key], code, 256)
        if "parentContentRunId" in value:
            fields["parentContentRunId"] = self._text(value["parentContentRunId"], "CONTENT_RUN_PARENT_ID_INVALID", 128)
        if "revisionCreatedAt" in value:
            created_at = self._text(value["revisionCreatedAt"], "CONTENT_RUN_REVISION_DATE_INVALID", 80)
            if _parse_iso_date(created_at) is None:
                raise StateValidationError("CONTENT_RUN_REVISION_DATE_INVALID")
            fields["revisionCreatedAt"] = created_at
        if "revisionHistory" in value:
            history = value["revisionHistory"]
            if not isinstance(history, list) or len(history) > 100:
                raise StateValidationError("CONTENT_RUN_REVISION_HISTORY_INVALID")
            for item in history:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("title"), str) or not isinstance(item.get("body"), str) or not isinstance(item.get("createdAt"), str):
                    raise StateValidationError("CONTENT_RUN_REVISION_HISTORY_INVALID")
                if len(item["id"].strip()) > 256 or len(item["title"].strip()) > 6000 or len(item["body"]) > 50000 or len(item["createdAt"].strip()) > 80:
                    raise StateValidationError("CONTENT_RUN_REVISION_HISTORY_INVALID")
            fields["revisionHistory"] = history
        return fields

    def _content_run_has_active_publication(self, content_run_id: str) -> bool:
        rows = self.connection.execute("SELECT state FROM target_publications WHERE content_run_id = ?", (content_run_id,)).fetchall()
        return any(str(row["state"] or "") not in _TERMINAL_PUBLICATION_STATES for row in rows)

    def _content_run_has_provider_confirmed_publication(self, content_run_id: str) -> bool:
        row = self.connection.execute("SELECT 1 FROM target_publications WHERE content_run_id = ? AND state = 'published' AND simulation = 0 AND provider_job_id IS NOT NULL AND trim(provider_job_id) != '' LIMIT 1", (content_run_id,)).fetchone()
        return row is not None

    def _content_run_is_locked(self, content_run_id: str, payload: dict[str, Any]) -> bool:
        return payload.get("state") in {"scheduled", "publishing", "published"} or payload.get("approvalState") in {"approved", "scheduled", "publishing", "published"} or self._content_run_has_active_publication(content_run_id) or self._content_run_has_provider_confirmed_publication(content_run_id)

    def _content_run_media_evidence(self, value: Any, client_id: str, brand_id: str) -> list[dict[str, Any]]:
        if not isinstance(value, list) or len(value) > 6:
            raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
        self._reject_local_media_paths(value)
        allowed = {"assetId", "sha256", "mimeType", "order", "role", "uploadState", "attachmentBoundary"}
        evidence = []
        asset_ids = set()
        for index, item in enumerate(value):
            required = {"assetId", "sha256", "mimeType", "order", "role", "uploadState"}
            if not isinstance(item, dict) or not required.issubset(item) or not set(item).issubset(allowed):
                raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
            asset_id = self._text(item["assetId"], "CONTENT_RUN_MEDIA_EVIDENCE_INVALID", 128)
            sha256_value = item["sha256"]
            mime_type = item["mimeType"]
            order = item["order"]
            role = item["role"]
            upload_state = item["uploadState"]
            if asset_id in asset_ids or not isinstance(sha256_value, str) or re.fullmatch(r"[a-fA-F0-9]{64}", sha256_value) is None:
                raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
            if not isinstance(mime_type, str) or re.fullmatch(r"(?:image|video)/[a-z0-9.+-]+", mime_type.strip(), re.IGNORECASE) is None:
                raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
            if isinstance(order, bool) or not isinstance(order, int) or order != index:
                raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
            if role != ("publish" if index == 0 else "reference") or not isinstance(upload_state, str) or upload_state not in {"pending", "processed", "failed"}:
                raise StateValidationError("CONTENT_RUN_MEDIA_EVIDENCE_INVALID")
            asset_ids.add(asset_id)
            record = {"assetId": asset_id, "sha256": sha256_value.lower(), "mimeType": mime_type.strip().lower(), "order": order, "role": role, "uploadState": upload_state}
            if "attachmentBoundary" in item:
                record["attachmentBoundary"] = self._text(item["attachmentBoundary"], "CONTENT_RUN_MEDIA_EVIDENCE_INVALID", 64)
            evidence.append(record)
        for record in evidence:
            asset_row = self.connection.execute("SELECT client_id, brand_id, metadata_json FROM media_assets WHERE id = ?", (record["assetId"],)).fetchone()
            if asset_row is None:
                raise StateValidationError("CONTENT_RUN_MEDIA_ASSET_MISSING")
            try:
                asset_metadata = json.loads(asset_row["metadata_json"] or "{}")
            except json.JSONDecodeError:
                asset_metadata = {}
            if not isinstance(asset_metadata, dict):
                asset_metadata = {}
            reusable_media = isinstance(asset_metadata, dict) and (
                asset_metadata.get("distribution") == "universal"
                or asset_metadata.get("shared") is True
                or isinstance(asset_metadata.get("sharedBrandIds"), list) and brand_id in asset_metadata.get("sharedBrandIds", [])
            )
            if asset_row["client_id"] != client_id or (asset_row["brand_id"] != brand_id and not reusable_media):
                raise StateValidationError("CONTENT_RUN_MEDIA_ASSET_SCOPE_MISMATCH")
            if asset_metadata.get("archiveState", "active") != "active":
                raise StateValidationError("CONTENT_RUN_MEDIA_ASSET_ARCHIVED")
            stored_sha256 = asset_metadata.get("sha256")
            if isinstance(stored_sha256, str):
                stored_sha256 = re.sub(r"^sha256:", "", stored_sha256, flags=re.IGNORECASE).lower()
            stored_mime_type = asset_metadata.get("mimeType")
            if stored_sha256 != record["sha256"] or not isinstance(stored_mime_type, str) or stored_mime_type.strip().lower() != record["mimeType"]:
                raise StateValidationError("CONTENT_RUN_MEDIA_ASSET_METADATA_MISMATCH")
        return evidence

    def _reject_local_media_paths(self, value: Any, error_code: str = "CONTENT_RUN_MEDIA_PATH_REJECTED") -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                normalized = str(key).lower().replace("_", "").replace("-", "")
                if normalized.endswith("path"):
                    raise StateValidationError(error_code)
                self._reject_local_media_paths(item, error_code)
        elif isinstance(value, list):
            for item in value:
                self._reject_local_media_paths(item, error_code)
        elif isinstance(value, str) and _LOCAL_MEDIA_PATH.match(value.strip()):
            raise StateValidationError(error_code)

    def create_target_publication(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        binding_id = self._text(value.get("bindingId"), "TARGET_PUBLICATION_BINDING_MISSING", 128)
        variant_id = self._text(value.get("variantId"), "TARGET_PUBLICATION_VARIANT_MISSING", 128)
        client_id = value.get("clientId")
        brand_id = value.get("brandId")
        idempotency_key = value.get("idempotencyKey")
        if not idempotency_key:
            client_id = self._text(client_id, "TARGET_PUBLICATION_CLIENT_MISSING", 128)
            brand_id = self._text(brand_id, "TARGET_PUBLICATION_BRAND_MISSING", 128)
            scheduled_slot = _utc_iso(self._text(value.get("scheduledSlot"), "TARGET_PUBLICATION_SCHEDULE_REQUIRED", 80))
            idempotency_key = self.target_publication_idempotency_key(client_id, brand_id, binding_id, variant_id, scheduled_slot)
        record = {"id": self._text(value.get("id"), "TARGET_PUBLICATION_ID_INVALID", 128), "bindingId": binding_id, "variantId": variant_id, "idempotencyKey": self._text(idempotency_key, "TARGET_PUBLICATION_KEY_INVALID", 512), "approvalState": self._text(value.get("approvalState"), "TARGET_PUBLICATION_APPROVAL_INVALID", 40), "state": self._text(value.get("state"), "TARGET_PUBLICATION_STATE_INVALID", 40)}
        if record["approvalState"] != "approved":
            raise StateValidationError("TARGET_PUBLICATION_APPROVAL_REQUIRED")
        binding = self._row("SELECT b.brand_id, b.target_external_id, br.client_id, br.deleted_at, c.platform FROM channel_bindings b JOIN brands br ON br.id = b.brand_id JOIN connections c ON c.id = b.connection_id WHERE b.id = ?", (binding_id,), "TARGET_PUBLICATION_BINDING_MISSING")
        client_id = client_id or binding["client_id"]
        brand_id = brand_id or binding["brand_id"]
        if client_id != binding["client_id"] or brand_id != binding["brand_id"]:
            raise StateValidationError("TARGET_PUBLICATION_SCOPE_MISMATCH")
        if binding["deleted_at"]:
            raise StateValidationError("BRAND_TRASHED")
        content_run_id = self._text(value.get("contentRunId"), "TARGET_PUBLICATION_CONTENT_RUN_INVALID", 128) if value.get("contentRunId") is not None else None
        self._assert_content_run_scope(content_run_id, str(client_id), str(brand_id))
        scheduled_value = value.get("scheduledAt") or value.get("scheduledSlot")
        scheduled_at = _utc_iso(scheduled_value) if scheduled_value is not None and isinstance(scheduled_value, str) else None
        if scheduled_value is not None and scheduled_at is None:
            raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
        plan_id = self._text(value.get("planId"), "PLAN_ID_INVALID", 128) if value.get("planId") is not None else None
        if plan_id and scheduled_at:
            self._validate_plan_schedule(plan_id, str(brand_id), scheduled_at, target_page_id=str(binding["target_external_id"]), platform=str(binding["platform"]))
        simulation = value.get("simulation", False)
        if not isinstance(simulation, bool):
            raise StateValidationError("TARGET_PUBLICATION_SIMULATION_INVALID")
        if simulation:
            raise StateValidationError("TARGET_PUBLICATION_SIMULATION_REMOVED")
        simulation = False
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            if scheduled_at is not None and record["state"] not in {"published", "canceled", "permanent_error", "failed", "blocked", "approval_failed"}:
                self._assert_slot_available(str(binding["platform"]), str(binding["target_external_id"]), scheduled_at)
            self.connection.execute("INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, legacy_non_live, scheduled_at, target_external_id, target_platform, plan_id, content_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)", (record["id"], binding_id, variant_id, record["idempotencyKey"], record["approvalState"], record["state"], client_id, brand_id, scheduled_at, binding["target_external_id"], binding["platform"], plan_id, content_run_id))
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            raise StateValidationError("TARGET_PUBLICATION_IDEMPOTENCY_CONFLICT") from error
        return {**record, "simulation": False, "legacyNonLive": False, "clientId": client_id, "brandId": brand_id, "scheduledAt": scheduled_at, "targetExternalId": binding["target_external_id"], "targetPlatform": binding["platform"], "planId": plan_id, "contentRunId": content_run_id, "revision": 0, "workerJobId": None, "workerRevision": 0, "pendingCommandId": None, "workerAckState": "unacknowledged"}

    def _assert_content_run_scope(self, content_run_id: str | None, client_id: str, brand_id: str) -> dict[str, Any] | None:
        if content_run_id is None:
            return None
        row = self.connection.execute("SELECT client_id, brand_id, payload_json FROM content_runs WHERE id = ?", (content_run_id,)).fetchone()
        if row is None:
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MISSING")
        if row["client_id"] != client_id or row["brand_id"] != brand_id:
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_SCOPE_MISMATCH")
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _publication_command_fingerprint(command: dict[str, Any]) -> str:
        return sha256(json.dumps(command, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _content_run_media_snapshot(payload: dict[str, Any], variant_id: str) -> dict[str, Any]:
        payload = AgencyStateStore._normalize_content_run_media_revision_aliases(payload)
        variants = payload.get("variants") if isinstance(payload.get("variants"), list) else []
        variant = next((item for item in variants if isinstance(item, dict) and item.get("id") == variant_id), None)
        containers = [variant] if isinstance(variant, dict) else []
        containers.append(payload)
        metadata = variant.get("metadata") if isinstance(variant, dict) and isinstance(variant.get("metadata"), dict) else {}
        containers.insert(1, metadata)

        def first_list(key: str) -> list[Any]:
            for container in containers:
                value = container.get(key) if isinstance(container, dict) else None
                if isinstance(value, list) and value:
                    return list(value)
            return []

        def first_value(key: str) -> Any:
            for container in containers:
                value = container.get(key) if isinstance(container, dict) else None
                if value is not None:
                    return value
            return None

        evidence = first_list("mediaEvidence")
        asset_ids = first_list("mediaAssetIds")
        if not asset_ids:
            asset_ids = [item.get("assetId") for item in evidence if isinstance(item, dict) and item.get("assetId")]
        fingerprint = first_value("mediaSetFingerprint")
        if not isinstance(fingerprint, str):
            fingerprint = payload.get("mediaSetFingerprint")
        return {
            "mediaAssetIds": asset_ids,
            "mediaEvidence": evidence,
            "mediaSetFingerprint": fingerprint.lower() if isinstance(fingerprint, str) else fingerprint,
            "mediaRevision": payload.get("mediaRevision", 0),
        }

    @staticmethod
    def _assert_content_run_variant(content_run_payload: dict[str, Any] | None, variant_id: str) -> None:
        if content_run_payload is None:
            return
        variants = content_run_payload.get("variants")
        if not isinstance(variants, list) or not any(isinstance(item, dict) and item.get("id") == variant_id for item in variants):
            raise StateValidationError("TARGET_PUBLICATION_VARIANT_NOT_IN_CONTENT_RUN")

    @staticmethod
    def _worker_media_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
        def aliased(keys: tuple[str, ...], *, case_insensitive: bool = False) -> tuple[bool, Any]:
            present = [(key, payload[key]) for key in keys if key in payload]
            if not present:
                return False, None
            comparable = [value.lower() if case_insensitive and isinstance(value, str) else value for _, value in present]
            if any(value != comparable[0] for value in comparable[1:]):
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
            return True, present[0][1]

        has_explicit_ids, explicit_ids = aliased(("mediaAssetIds", "media_asset_ids"))
        has_explicit_fingerprint, explicit_fingerprint = aliased(("mediaSetFingerprint", "media_set_fingerprint"), case_insensitive=True)
        has_explicit_revision, explicit_revision = aliased(("mediaRevision", "media_revision", "contentRunRevision", "content_run_revision"))
        legacy_asset_id = payload.get("media_asset_id")
        return {
            "hasExplicitIds": has_explicit_ids,
            "mediaAssetIds": list(explicit_ids) if isinstance(explicit_ids, list) else explicit_ids,
            "hasExplicitFingerprint": has_explicit_fingerprint,
            "mediaSetFingerprint": explicit_fingerprint.lower() if isinstance(explicit_fingerprint, str) else explicit_fingerprint,
            "hasExplicitRevision": has_explicit_revision,
            "mediaRevision": explicit_revision,
            "hasLegacyAssetId": "media_asset_id" in payload,
            "legacyAssetId": legacy_asset_id,
            "legacySha256": payload.get("media_sha256"),
            "legacyMimeType": payload.get("media_mime_type", payload.get("media_mime")),
        }

    def _validate_content_run_approval_media_snapshot(self, value: dict[str, Any], content_run_payload: dict[str, Any] | None, variant_id: str, worker_payload: dict[str, Any] | None, simulation: bool) -> None:
        if not isinstance(content_run_payload, dict) or not self._content_run_has_media(content_run_payload):
            return
        expected = self._content_run_media_snapshot(content_run_payload, variant_id)
        expected_ids = expected["mediaAssetIds"]
        expected_fingerprint = expected["mediaSetFingerprint"]
        expected_revision = expected["mediaRevision"]
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 0:
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_REVISION_INVALID")

        for key in ("mediaRevision", "media_revision", "contentRunRevision", "content_run_revision"):
            if key in value and value[key] != expected_revision:
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        for key in ("mediaSetFingerprint", "media_set_fingerprint"):
            if key in value and (not isinstance(value[key], str) or value[key].lower() != expected_fingerprint):
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        for key in ("mediaAssetIds", "media_asset_ids"):
            if key in value and value[key] != expected_ids:
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")

        if worker_payload is None:
            if simulation:
                return
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_REQUIRED")
        worker = self._worker_media_snapshot(worker_payload)
        legacy = worker["hasLegacyAssetId"]
        legacy_only = legacy and not worker["hasExplicitIds"] and not worker["hasExplicitFingerprint"]
        if worker["hasExplicitRevision"]:
            if not isinstance(worker["mediaRevision"], int) or isinstance(worker["mediaRevision"], bool) or worker["mediaRevision"] != expected_revision:
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        elif not legacy_only:
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_REVISION_REQUIRED")
        if worker["hasExplicitIds"]:
            if not isinstance(worker["mediaAssetIds"], list) or worker["mediaAssetIds"] != expected_ids:
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        if legacy and (not isinstance(worker["legacyAssetId"], str) or not expected_ids or worker["legacyAssetId"] != expected_ids[0]):
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        if worker["hasExplicitFingerprint"]:
            if not isinstance(worker["mediaSetFingerprint"], str) or worker["mediaSetFingerprint"] != expected_fingerprint:
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
        elif not legacy_only:
            raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_FINGERPRINT_REQUIRED")
        evidence = expected["mediaEvidence"]
        if legacy and evidence:
            first = evidence[0]
            if isinstance(worker["legacySha256"], str) and worker["legacySha256"].replace("sha256:", "").lower() != first.get("sha256"):
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")
            if isinstance(worker["legacyMimeType"], str) and worker["legacyMimeType"].lower() != first.get("mimeType"):
                raise StateValidationError("TARGET_PUBLICATION_CONTENT_RUN_MEDIA_SNAPSHOT_STALE")

    def begin_target_publication_approval(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        publication_id = self._text(value.get("id"), "TARGET_PUBLICATION_ID_INVALID", 128)
        existing = self.connection.execute("SELECT simulation, legacy_non_live FROM target_publications WHERE id = ?", (publication_id,)).fetchone()
        if existing is not None and (bool(existing["simulation"]) or bool(existing["legacy_non_live"])):
            raise StateValidationError("LEGACY_NON_LIVE_ACTION_BLOCKED")
        binding_id = self._text(value.get("bindingId"), "TARGET_PUBLICATION_BINDING_MISSING", 128)
        client_id = self._text(value.get("clientId"), "TARGET_PUBLICATION_CLIENT_MISSING", 128)
        brand_id = self._text(value.get("brandId"), "TARGET_PUBLICATION_BRAND_MISSING", 128)
        variant_id = self._text(value.get("variantId"), "TARGET_PUBLICATION_VARIANT_MISSING", 128)
        identity_version_id = self._text(value.get("identityVersionId"), "TARGET_PUBLICATION_IDENTITY_MISSING", 160) if value.get("identityVersionId") is not None else None
        idempotency_key = self._text(value.get("idempotencyKey"), "TARGET_PUBLICATION_KEY_INVALID", 512)
        if value.get("approvalState") != "approved":
            raise StateValidationError("TARGET_PUBLICATION_APPROVAL_REQUIRED")
        scheduled_value = value.get("scheduledAt")
        if not isinstance(scheduled_value, str):
            raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
        scheduled_at = _utc_iso(scheduled_value)
        parsed = _parse_iso_date(scheduled_at)
        if parsed is None or parsed.timestamp() <= datetime.now(timezone.utc).timestamp():
            raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
        plan_id = self._text(value.get("planId"), "PLAN_ID_INVALID", 128) if value.get("planId") is not None else None
        content_run_id = self._text(value.get("contentRunId"), "TARGET_PUBLICATION_CONTENT_RUN_INVALID", 128) if value.get("contentRunId") is not None else None
        request_id = self._text(value.get("requestId") or f"approve-{publication_id}", "PUBLICATION_REQUEST_ID_INVALID", 160)
        simulation = value.get("simulation", False)
        if not isinstance(simulation, bool):
            raise StateValidationError("TARGET_PUBLICATION_SIMULATION_INVALID")
        if simulation:
            raise StateValidationError("TARGET_PUBLICATION_SIMULATION_REMOVED")
        simulation = False
        binding = self._row("SELECT b.brand_id, b.target_external_id, b.state, br.client_id, br.deleted_at, c.platform FROM channel_bindings b JOIN brands br ON br.id = b.brand_id JOIN connections c ON c.id = b.connection_id WHERE b.id = ?", (binding_id,), "TARGET_PUBLICATION_BINDING_MISSING")
        worker_job = value.get("workerJob")
        if worker_job is not None and not isinstance(worker_job, dict):
            raise StateValidationError("TARGET_PUBLICATION_WORKER_JOB_INVALID")
        payload = worker_job.get("payload") if isinstance(worker_job, dict) else None
        if worker_job is None:
            raise StateValidationError("TARGET_PUBLICATION_WORKER_JOB_REQUIRED")
        if worker_job is not None:
            if not isinstance(payload, dict):
                raise StateValidationError("TARGET_PUBLICATION_WORKER_PAYLOAD_INVALID")
            payload = dict(payload)
            if "simulation" in payload:
                if not isinstance(payload["simulation"], bool):
                    raise StateValidationError("TARGET_PUBLICATION_SIMULATION_INVALID")
                if payload["simulation"]:
                    raise StateValidationError("TARGET_PUBLICATION_SIMULATION_REMOVED")
                payload.pop("simulation")
            worker_job_id = self._text(worker_job.get("jobId"), "WORKER_JOB_ID_INVALID", 240)
            worker_key = self._text(worker_job.get("idempotencyKey"), "WORKER_JOB_KEY_INVALID", 512)
            worker_schedule = _utc_iso(self._text(worker_job.get("scheduledAt"), "WORKER_JOB_SCHEDULE_INVALID", 80))
            if worker_key != idempotency_key or worker_schedule != scheduled_at:
                raise StateValidationError("TARGET_PUBLICATION_WORKER_JOB_MISMATCH")
            if payload.get("target_publication_id") != publication_id or payload.get("binding_id") != binding_id or payload.get("page_id") != binding["target_external_id"]:
                raise StateValidationError("TARGET_PUBLICATION_WORKER_TARGET_MISMATCH")
            if payload.get("plan_id") != plan_id:
                raise StateValidationError("TARGET_PUBLICATION_WORKER_PLAN_MISMATCH")
            if payload.get("content_run_id") != content_run_id:
                raise StateValidationError("TARGET_PUBLICATION_WORKER_CONTENT_RUN_MISMATCH")
            if "variant_id" in payload and payload.get("variant_id") != variant_id:
                raise StateValidationError("TARGET_PUBLICATION_WORKER_VARIANT_MISMATCH")
            if payload.get("client_id") != client_id or payload.get("brand_id") != brand_id or payload.get("identity_version_id") != identity_version_id or payload.get("platform") != value.get("platform") or payload.get("kind") != value.get("kind"):
                raise StateValidationError("TARGET_PUBLICATION_WORKER_CONTRACT_MISMATCH")
            if payload.get("approval_state") != "approved":
                raise StateValidationError("TARGET_PUBLICATION_WORKER_APPROVAL_MISMATCH")
            worker_job = {"jobId": worker_job_id, "idempotencyKey": worker_key, "scheduledAt": scheduled_at, "scheduledAtSeconds": parsed.timestamp(), "payload": payload}
        command = {"action": "approve", "requestId": request_id, "publicationId": publication_id, "clientId": client_id, "brandId": brand_id, "bindingId": binding_id, "variantId": variant_id, "planId": plan_id, "contentRunId": content_run_id, "scheduledAt": scheduled_at, "workerJob": worker_job, "workerJobId": worker_job["jobId"] if worker_job else None, "workerRevision": 0}
        fingerprint = self._publication_command_fingerprint(command)
        prior = self.connection.execute("SELECT fingerprint FROM publication_commands WHERE request_id = ?", (request_id,)).fetchone()
        if prior is not None:
            if prior["fingerprint"] != fingerprint:
                raise StateValidationError("PUBLICATION_REQUEST_ID_REUSED")
            return self._publication_command_status(request_id)
        if binding["brand_id"] != brand_id or binding["client_id"] != client_id:
            raise StateValidationError("TARGET_PUBLICATION_SCOPE_MISMATCH")
        if binding["deleted_at"]:
            raise StateValidationError("BRAND_TRASHED")
        content_run_payload = self._assert_content_run_scope(content_run_id, client_id, brand_id)
        self._assert_content_run_variant(content_run_payload, variant_id)
        if binding["state"] != "connected":
            raise StateValidationError("TARGET_PUBLICATION_BINDING_NOT_CONNECTED")
        preflight = self.preflight_target_publication({
            "clientId": client_id,
            "brandId": brand_id,
            "bindingId": binding_id,
            "identityVersionId": identity_version_id,
            "variantId": variant_id,
            "platform": value.get("platform"),
            "kind": value.get("kind"),
            "scheduledAt": scheduled_at,
            "approvalState": "approved",
            "requiredScopes": value.get("requiredScopes", []),
            "mediaRequired": value.get("mediaRequired", False),
            "mediaEligible": value.get("mediaEligible"),
            "mediaUrl": value.get("mediaUrl"),
        })
        if preflight.get("ok") is not True:
            reason = str(preflight.get("blockReason") or "target_not_ready").upper()
            raise StateValidationError(f"TARGET_PUBLICATION_PREFLIGHT_BLOCKED_{reason}")
        required_scopes = value.get("requiredScopes", [])
        if worker_job is not None and payload.get("required_scopes") != required_scopes:
            raise StateValidationError("TARGET_PUBLICATION_WORKER_SCOPES_MISMATCH")
        if plan_id:
            self._validate_plan_schedule(plan_id, brand_id, scheduled_at, target_page_id=str(binding["target_external_id"]), platform=str(binding["platform"]))
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            prior = self.connection.execute("SELECT fingerprint FROM publication_commands WHERE request_id = ?", (request_id,)).fetchone()
            if prior is not None:
                if prior["fingerprint"] != fingerprint:
                    raise StateValidationError("PUBLICATION_REQUEST_ID_REUSED")
                self.connection.commit()
                return self._publication_command_status(request_id)
            if self.connection.execute("SELECT id FROM target_publications WHERE id = ?", (publication_id,)).fetchone() is not None:
                raise StateValidationError("TARGET_PUBLICATION_EXISTS")
            current_content_run_payload = self._assert_content_run_scope(content_run_id, client_id, brand_id)
            self._assert_content_run_variant(current_content_run_payload, variant_id)
            self._validate_content_run_approval_media_snapshot(value, current_content_run_payload, variant_id, payload, simulation)
            self._assert_slot_available(str(binding["platform"]), str(binding["target_external_id"]), scheduled_at)
            state = "approval_pending"
            ack_state = "pending"
            self.connection.execute("INSERT INTO target_publications(id, binding_id, variant_id, idempotency_key, approval_state, state, client_id, brand_id, simulation, legacy_non_live, scheduled_at, target_external_id, target_platform, plan_id, content_run_id, worker_job_id, worker_revision, pending_command_id, worker_ack_state) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?)", (publication_id, binding_id, variant_id, idempotency_key, state, client_id, brand_id, scheduled_at, binding["target_external_id"], binding["platform"], plan_id, content_run_id, command["workerJobId"], request_id, ack_state))
            response = {"id": publication_id, "state": state, "scheduledAt": scheduled_at, "workerJobId": command["workerJobId"], "revision": 0, "workerRevision": 0}
            status = "acknowledged" if ack_state in {"acknowledged", "not_required"} else "pending"
            self.connection.execute("INSERT INTO publication_commands(request_id, publication_id, action, fingerprint, status, command_json, response_json, created_at, updated_at) VALUES (?, ?, 'approve', ?, ?, ?, ?, ?, ?)", (request_id, publication_id, fingerprint, status, json.dumps(command, separators=(",", ":")), json.dumps(response, separators=(",", ":")) if status == "acknowledged" else None, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")))
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            raise StateValidationError("TARGET_PUBLICATION_IDEMPOTENCY_CONFLICT") from error
        except Exception:
            self.connection.rollback()
            raise
        return self._publication_command_status(request_id)

    def begin_target_publication_command(self, publication_id: str, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        publication_id = self._text(publication_id, "TARGET_PUBLICATION_ID_INVALID", 128)
        action = value.get("action")
        if action not in {"publish_now", "reschedule", "cancel"}:
            raise StateValidationError("PUBLICATION_ACTION_INVALID")
        request_id = self._text(value.get("requestId"), "PUBLICATION_REQUEST_ID_INVALID", 160)
        expected_revision = value.get("expectedRevision")
        if not isinstance(expected_revision, int) or expected_revision < 0:
            raise StateValidationError("PUBLICATION_REVISION_REQUIRED")
        client_id = self._text(value.get("clientId"), "TARGET_PUBLICATION_CLIENT_MISSING", 128)
        brand_id = self._text(value.get("brandId"), "TARGET_PUBLICATION_BRAND_MISSING", 128)
        scheduled_at = None
        if action == "reschedule":
            raw_scheduled_at = value.get("scheduledAt")
            if not isinstance(raw_scheduled_at, str):
                raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
            scheduled_at = _utc_iso(raw_scheduled_at)
            parsed = _parse_iso_date(scheduled_at)
            if parsed is None or parsed.timestamp() <= datetime.now(timezone.utc).timestamp():
                raise StateValidationError("TARGET_PUBLICATION_SCHEDULE_INVALID")
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            prior = self.connection.execute("SELECT fingerprint FROM publication_commands WHERE request_id = ?", (request_id,)).fetchone()
            fingerprint_data = {"action": action, "publicationId": publication_id, "clientId": client_id, "brandId": brand_id, "expectedRevision": expected_revision, "scheduledAt": scheduled_at}
            fingerprint = self._publication_command_fingerprint(fingerprint_data)
            if prior is not None:
                if prior["fingerprint"] != fingerprint:
                    raise StateValidationError("PUBLICATION_REQUEST_ID_REUSED")
                self.connection.commit()
                return self._publication_command_status(request_id)
            row = self._row("SELECT * FROM target_publications WHERE id = ?", (publication_id,), "TARGET_PUBLICATION_MISSING")
            if row["client_id"] != client_id or row["brand_id"] != brand_id:
                raise StateValidationError("TARGET_PUBLICATION_SCOPE_MISMATCH")
            if row["pending_command_id"]:
                raise StateValidationError("PUBLICATION_COMMAND_PENDING")
            if bool(row["simulation"]) or bool(row["legacy_non_live"]):
                raise StateValidationError("LEGACY_NON_LIVE_ACTION_BLOCKED")
            if row["worker_ack_state"] != "acknowledged" or not row["worker_job_id"]:
                raise StateValidationError("PUBLICATION_WORKER_NOT_ACKNOWLEDGED")
            if row["revision"] != expected_revision:
                raise StateValidationError("PUBLICATION_REVISION_CONFLICT")
            if row["state"] not in {"scheduled", "queued", "retryable_error"}:
                raise StateValidationError("TARGET_PUBLICATION_STATE_CONFLICT")
            if action in {"reschedule", "publish_now"}:
                candidate_at = scheduled_at if action == "reschedule" else datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                if row["plan_id"]:
                    self._validate_plan_schedule(str(row["plan_id"]), brand_id, candidate_at, target_page_id=str(row["target_external_id"]), platform=str(row["target_platform"]), validate_run_day=action == "reschedule")
                self._assert_slot_available(str(row["target_platform"]), str(row["target_external_id"]), candidate_at, publication_id)
                scheduled_at = candidate_at
            command = {"action": action, "requestId": request_id, "publicationId": publication_id, "clientId": client_id, "brandId": brand_id, "expectedRevision": expected_revision, "workerJobId": row["worker_job_id"], "workerRevision": row["worker_revision"], "scheduledAt": scheduled_at, "scheduledAtSeconds": _parse_iso_date(scheduled_at).timestamp() if scheduled_at else None}
            now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            self.connection.execute("INSERT INTO publication_commands(request_id, publication_id, action, fingerprint, status, command_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)", (request_id, publication_id, action, fingerprint, json.dumps(command, separators=(",", ":")), now, now))
            self.connection.execute("UPDATE target_publications SET pending_command_id = ?, worker_ack_state = 'pending' WHERE id = ?", (request_id, publication_id))
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.IntegrityError as error:
            self.connection.rollback()
            raise StateValidationError("PUBLICATION_COMMAND_CONFLICT") from error
        return self._publication_command_status(request_id)

    def pending_publication_commands(self) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT request_id, command_json, error_code FROM publication_commands WHERE status = 'pending' ORDER BY created_at, request_id").fetchall()
        return [{**json.loads(row["command_json"]), "errorCode": row["error_code"]} for row in rows]

    def _publication_command_status(self, request_id: str) -> dict[str, Any]:
        row = self._row("SELECT c.status, c.error_code, c.response_json, c.command_json, c.publication_id, p.client_id, p.brand_id FROM publication_commands c JOIN target_publications p ON p.id = c.publication_id WHERE c.request_id = ?", (request_id,), "PUBLICATION_COMMAND_MISSING")
        publication = next(item for item in self.list_target_publications(str(row["client_id"]), str(row["brand_id"])) if item["id"] == row["publication_id"])
        return {**publication, "commandId": request_id, "commandStatus": row["status"], "commandError": row["error_code"], "command": json.loads(row["command_json"]), "commandResponse": json.loads(row["response_json"]) if row["response_json"] else None}

    def mark_publication_command_pending_error(self, request_id: str, error_code: str) -> dict[str, Any]:
        self.connection.execute("UPDATE publication_commands SET error_code = ?, updated_at = ? WHERE request_id = ? AND status = 'pending'", (error_code, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), request_id))
        self.connection.commit()
        return self._publication_command_status(request_id)

    def fail_publication_command(self, request_id: str, error_code: str) -> dict[str, Any]:
        row = self._row("SELECT publication_id, action FROM publication_commands WHERE request_id = ? AND status = 'pending'", (request_id,), "PUBLICATION_COMMAND_MISSING")
        self.connection.execute("UPDATE publication_commands SET status = 'failed', error_code = ?, updated_at = ? WHERE request_id = ?", (error_code, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), request_id))
        ack_state = "failed" if row["action"] == "approve" else "reconciliation_required" if error_code in {"WORKER_JOB_STATE_CONFLICT", "WORKER_JOB_OUTCOME_UNKNOWN", "WORKER_JOB_REVISION_CONFLICT"} else "acknowledged"
        next_state = "approval_failed" if row["action"] == "approve" else None
        self.connection.execute("UPDATE target_publications SET pending_command_id = NULL, worker_ack_state = ?, state = COALESCE(?, state) WHERE id = ?", (ack_state, next_state, row["publication_id"]))
        self.connection.commit()
        return self._publication_command_status(request_id)

    def mark_publication_command_reconciliation_required(self, request_id: str, error_code: str) -> dict[str, Any]:
        row = self._row("SELECT publication_id, action FROM publication_commands WHERE request_id = ? AND status = 'pending'", (request_id,), "PUBLICATION_COMMAND_MISSING")
        if row["action"] != "approve":
            raise StateValidationError("PUBLICATION_RECONCILIATION_ACTION_INVALID")
        self.connection.execute("UPDATE publication_commands SET error_code = ?, updated_at = ? WHERE request_id = ?", (error_code, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), request_id))
        self.connection.execute("UPDATE target_publications SET state = 'reconciliation_required', worker_ack_state = 'reconciliation_required' WHERE id = ? AND pending_command_id = ?", (row["publication_id"], request_id))
        self.connection.commit()
        return self._publication_command_status(request_id)

    def acknowledge_publication_command(self, request_id: str, worker_response: dict[str, Any]) -> dict[str, Any]:
        row = self._row("SELECT c.*, p.worker_job_id, p.worker_revision, p.scheduled_at, p.revision FROM publication_commands c JOIN target_publications p ON p.id = c.publication_id WHERE c.request_id = ?", (request_id,), "PUBLICATION_COMMAND_MISSING")
        if row["status"] != "pending":
            return self._publication_command_status(request_id)
        command = json.loads(row["command_json"] or "{}")
        action = row["action"]
        worker_job_id = str(row["worker_job_id"] or "")
        response_job_id = worker_response.get("id", worker_response.get("jobId"))
        if response_job_id != worker_job_id:
            if row["action"] == "approve":
                return self.fail_publication_command(request_id, "WORKER_JOB_IDEMPOTENCY_CONFLICT")
            raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
        worker_revision = worker_response.get("revision", 0)
        if not isinstance(worker_revision, int) or worker_revision < 0:
            raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
        next_scheduled_at = row["scheduled_at"]
        next_state = "scheduled"
        terminal_at = None
        if action == "approve":
            worker_state = worker_response.get("state")
            if worker_state in {"canceled", "failed"}:
                return self.fail_publication_command(request_id, f"WORKER_JOB_ALREADY_{worker_state.upper()}")
            if worker_state in {"running", "unknown"}:
                return self.mark_publication_command_reconciliation_required(request_id, "WORKER_JOB_OUTCOME_UNKNOWN")
            if worker_state == "completed":
                provider_job_id = worker_response.get("provider_job_id")
                if not isinstance(provider_job_id, str) or not provider_job_id.strip():
                    return self.mark_publication_command_reconciliation_required(request_id, "WORKER_COMPLETED_PROVIDER_EVIDENCE_MISSING")
                revision = int(row["revision"])
                response = {"id": row["publication_id"], "state": "published", "scheduledAt": row["scheduled_at"], "workerJobId": worker_job_id, "providerJobId": provider_job_id, "revision": revision, "workerRevision": worker_revision}
                now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                self.connection.execute("UPDATE target_publications SET state = 'published', terminal_at = ?, provider_job_id = ?, pending_command_id = NULL, worker_revision = ?, worker_ack_state = 'acknowledged' WHERE id = ? AND pending_command_id = ?", (now, provider_job_id, worker_revision, row["publication_id"], request_id))
                self.connection.execute("UPDATE publication_commands SET status = 'acknowledged', response_json = ?, error_code = NULL, updated_at = ? WHERE request_id = ?", (json.dumps(response, separators=(",", ":")), now, request_id))
                self.connection.commit()
                return self._publication_command_status(request_id)
            if worker_state != "queued" or worker_revision != 0:
                return self.mark_publication_command_reconciliation_required(request_id, "WORKER_JOB_STATE_CONFLICT")
            worker_scheduled_at = worker_response.get("scheduled_at")
            if isinstance(worker_scheduled_at, bool) or not isinstance(worker_scheduled_at, (int, float)):
                return self.mark_publication_command_reconciliation_required(request_id, "WORKER_JOB_SCHEDULE_MISMATCH")
            try:
                confirmed_schedule = datetime.fromtimestamp(float(worker_scheduled_at), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            except (OverflowError, OSError, ValueError):
                return self.mark_publication_command_reconciliation_required(request_id, "WORKER_JOB_SCHEDULE_MISMATCH")
            if confirmed_schedule != _utc_iso(str(command["scheduledAt"])):
                return self.mark_publication_command_reconciliation_required(request_id, "WORKER_JOB_SCHEDULE_MISMATCH")
        else:
            if worker_revision != int(command["workerRevision"]) + 1:
                raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
            if action == "cancel":
                if worker_response.get("state") != "canceled":
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
                next_state = "canceled"
                terminal_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            elif action == "reschedule":
                if worker_response.get("state") != "queued":
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
                worker_scheduled_at = worker_response.get("scheduled_at")
                if isinstance(worker_scheduled_at, bool) or not isinstance(worker_scheduled_at, (int, float)):
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
                try:
                    confirmed_schedule = datetime.fromtimestamp(float(worker_scheduled_at), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                except (OverflowError, OSError, ValueError) as error:
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH") from error
                if confirmed_schedule != _utc_iso(str(command["scheduledAt"])):
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
                next_scheduled_at = confirmed_schedule
            elif action == "publish_now":
                if worker_response.get("state") != "queued":
                    raise StateValidationError("PUBLICATION_WORKER_ACK_MISMATCH")
                next_scheduled_at = datetime.fromtimestamp(float(worker_response["scheduled_at"]), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                next_state = "queued"
        revision = int(row["revision"]) + (1 if action != "approve" else 0)
        response = {"id": row["publication_id"], "state": next_state, "scheduledAt": next_scheduled_at, "workerJobId": worker_job_id, "revision": revision, "workerRevision": worker_revision}
        self.connection.execute("UPDATE target_publications SET state = ?, scheduled_at = ?, terminal_at = ?, revision = ?, worker_revision = ?, pending_command_id = NULL, worker_ack_state = 'acknowledged' WHERE id = ? AND pending_command_id = ?", (next_state, next_scheduled_at, terminal_at, revision, worker_revision, row["publication_id"], request_id))
        self.connection.execute("UPDATE publication_commands SET status = 'acknowledged', response_json = ?, error_code = NULL, updated_at = ? WHERE request_id = ?", (json.dumps(response, separators=(",", ":")), datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), request_id))
        self.connection.commit()
        return self._publication_command_status(request_id)

    def preflight_target_publication(self, value: dict[str, Any]) -> dict[str, Any]:
        """Return target-scoped checks without calling a provider."""
        self._validate_scalar(value)
        required = ("clientId", "brandId", "bindingId", "identityVersionId", "variantId", "platform", "kind", "scheduledAt")
        missing = [field for field in required if not isinstance(value.get(field), str) or not value[field].strip()]
        if missing:
            return {"ok": False, "blockReason": "CONTRACT_REQUIRED", "checks": [{"key": field, "ok": False, "message": "Required target publication field is missing."} for field in missing]}
        binding = self.connection.execute(
            """SELECT b.id, b.identity_id, b.state, b.target_external_id, b.brand_id,
                      br.client_id, br.deleted_at, c.platform, c.connection_state, c.scopes_json
               FROM channel_bindings b
               JOIN brands br ON br.id = b.brand_id
               JOIN connections c ON c.id = b.connection_id
              WHERE b.id = ?""",
            (value["bindingId"],),
        ).fetchone()
        if binding is None:
            return {"ok": False, "blockReason": "BINDING_MISSING", "checks": [{"key": "binding", "ok": False, "message": "Target binding does not exist."}]}
        checks: list[dict[str, Any]] = []
        checks.append({"key": "client", "ok": binding["client_id"] == value["clientId"], "message": "Client scope matches binding." if binding["client_id"] == value["clientId"] else "Binding belongs to another Client."})
        checks.append({"key": "brand", "ok": binding["brand_id"] == value["brandId"], "message": "Brand scope matches binding." if binding["brand_id"] == value["brandId"] else "Binding belongs to another Brand."})
        checks.append({"key": "brand_state", "ok": not binding["deleted_at"], "message": "Brand is available." if not binding["deleted_at"] else "Brand is in trash."})
        checks.append({"key": "identity", "ok": binding["identity_id"] == value["identityVersionId"], "message": "Identity version matches binding." if binding["identity_id"] == value["identityVersionId"] else "Identity version does not match the target binding."})
        checks.append({"key": "binding_state", "ok": binding["state"] == "connected", "message": "Binding is connected." if binding["state"] == "connected" else "Binding is not connected."})
        checks.append({"key": "connection_state", "ok": binding["connection_state"] == "connected", "message": "Connection is connected." if binding["connection_state"] == "connected" else "Connection needs reauthentication or review."})
        checks.append({"key": "platform", "ok": binding["platform"] == value["platform"], "message": "Platform matches target connection." if binding["platform"] == value["platform"] else "Platform does not match target connection."})
        if value.get("approvalState") is not None:
            checks.append({"key": "approval", "ok": value.get("approvalState") == "approved", "message": "Explicit approval is present." if value.get("approvalState") == "approved" else "Explicit approval is required."})
        required_scopes = value.get("requiredScopes", [])
        scopes = json.loads(binding["scopes_json"] or "[]")
        if not isinstance(required_scopes, list) or any(not isinstance(scope, str) or not scope for scope in required_scopes):
            checks.append({"key": "scopes_contract", "ok": False, "message": "Required scopes must be a list of non-empty names."})
        else:
            missing_scopes = [scope for scope in required_scopes if scope not in scopes]
            checks.append({"key": "scopes", "ok": not missing_scopes, "message": "Required scopes are present." if not missing_scopes else "Missing required target scopes."})
        scheduled = _parse_iso_date(value["scheduledAt"])
        checks.append({"key": "schedule", "ok": scheduled is not None and scheduled.timestamp() > datetime.now().timestamp(), "message": "Scheduled time is in the future." if scheduled is not None and scheduled.timestamp() > datetime.now().timestamp() else "Scheduled time must be in the future."})
        media_required = value.get("mediaRequired", False)
        if not isinstance(media_required, bool):
            checks.append({"key": "media_contract", "ok": False, "message": "Media requirement must be a boolean."})
        elif media_required:
            media_ok = value.get("mediaEligible") is True and isinstance(value.get("mediaUrl"), str) and value["mediaUrl"].startswith("https://")
            checks.append({"key": "media", "ok": media_ok, "message": "Public eligible media is present." if media_ok else "Public eligible media is required."})
        failed = next((check for check in checks if not check["ok"]), None)
        return {"ok": failed is None, "blockReason": None if failed is None else failed["key"], "checks": checks, "targetExternalId": binding["target_external_id"]}

    def create_provider_configuration(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        capabilities = value.get("capabilities", [])
        if not isinstance(capabilities, list) or not all(isinstance(item, str) and item for item in capabilities): raise StateValidationError("PROVIDER_CAPABILITIES_INVALID")
        if value.get("providerKind") not in {"openrouter", "google_gemini_api", "vertex_ai", "openai_official", "openai_compatible", "nvidia_nim", "opencode_go"}: raise StateValidationError("PROVIDER_KIND_UNSUPPORTED")
        record = {"id": self._text(value.get("id"), "PROVIDER_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "PROVIDER_CLIENT_MISSING", 128), "providerKind": self._text(value.get("providerKind"), "PROVIDER_KIND_UNSUPPORTED", 64), "displayName": self._text(value.get("displayName"), "PROVIDER_NAME_INVALID"), "model": self._text(value.get("model"), "PROVIDER_MODEL_INVALID", 240), "status": self._text(value.get("status"), "PROVIDER_STATUS_INVALID", 40), "capabilities": capabilities}
        secret_ref = value.get("secretRef")
        if not isinstance(secret_ref, str) or not re.fullmatch(r"(?:env|keychain):[A-Za-z0-9/_:.+-]{1,240}", secret_ref):
            raise StateValidationError("PROVIDER_SECRET_REF_INVALID")
        metadata = {key: value[key] for key in ("baseUrl", "projectId", "location", "checkedAt") if key in value}
        self._insert("INSERT INTO provider_configurations(id, client_id, provider_kind, display_name, model, status, capabilities_json, secret_ref, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["providerKind"], record["displayName"], record["model"], record["status"], json.dumps(capabilities, separators=(",", ":")), secret_ref, json.dumps(metadata, separators=(",", ":"))), "PROVIDER_CONFLICT")
        return record

    def create_knowledge_item(self, value: dict[str, Any]) -> dict[str, str]:
        self._validate_scalar(value)
        if value.get("rightsState") not in {"user_owned", "licensed"} or value.get("reviewState") != "approved": raise StateValidationError("RIGHTS_OR_REVIEW_BLOCKED")
        content_hash = self._text(value.get("contentHash"), "KNOWLEDGE_CONTENT_HASH_INVALID", 64)
        if not re.fullmatch(r"[a-fA-F0-9]{64}", content_hash): raise StateValidationError("KNOWLEDGE_CONTENT_HASH_INVALID")
        record = {"id": self._text(value.get("id"), "KNOWLEDGE_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "KNOWLEDGE_CLIENT_MISSING", 128), "brandId": self._text(value.get("brandId"), "KNOWLEDGE_BRAND_MISSING", 128), "title": self._text(value.get("title"), "KNOWLEDGE_TITLE_INVALID"), "contentHash": content_hash.lower(), "provenance": self._text(value.get("provenance"), "KNOWLEDGE_PROVENANCE_REQUIRED"), "rightsState": value["rightsState"], "reviewState": value["reviewState"]}
        brand = self._row("SELECT client_id FROM brands WHERE id = ?", (record["brandId"],), "KNOWLEDGE_BRAND_MISSING")
        if brand["client_id"] != record["clientId"]: raise StateValidationError("RIGHTS_OR_REVIEW_BLOCKED")
        self._insert("INSERT INTO knowledge_items(id, client_id, brand_id, title, content_hash, provenance, rights_state, review_state, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], record["title"], record["contentHash"], record["provenance"], record["rightsState"], record["reviewState"], json.dumps({"kind": value.get("kind"), "text": value.get("text"), "sourceUpdatedAt": value.get("sourceUpdatedAt")}, separators=(",", ":"))), "KNOWLEDGE_CONTENT_HASH_CONFLICT")
        self.connection.execute("INSERT INTO knowledge_items_fts(id, client_id, brand_id, title, body, source_title) VALUES (?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], record["title"], str(value.get("text", "")), str(value.get("sourceTitle", ""))))
        self.connection.commit()
        return record

    def list_knowledge_items(self, client_id: str, brand_id: str, include_archived: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM knowledge_items WHERE client_id = ? AND brand_id = ?"
        if not include_archived:
            query += " AND archive_state = 'active'"
        query += " ORDER BY title, id"
        rows = self.connection.execute(query, (self._text(client_id, "KNOWLEDGE_CLIENT_MISSING", 128), self._text(brand_id, "KNOWLEDGE_BRAND_MISSING", 128))).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            metadata = json.loads(row["metadata_json"])
            results.append({"id": row["id"], "clientId": row["client_id"], "brandId": row["brand_id"], "title": row["title"], "contentHash": row["content_hash"], "provenance": row["provenance"], "rightsState": row["rights_state"], "reviewState": row["review_state"], "archiveState": row["archive_state"], **metadata})
        return results

    def search_knowledge_items(self, client_id: str, brand_id: str, query: str) -> list[dict[str, Any]]:
        client_id = self._text(client_id, "KNOWLEDGE_CLIENT_MISSING", 128)
        brand_id = self._text(brand_id, "KNOWLEDGE_BRAND_MISSING", 128)
        query = self._text(query, "KNOWLEDGE_QUERY_REQUIRED", 400)
        terms = [re.sub(r"[^\w-]", "", term) for term in query.split()]
        terms = [term for term in terms if term]
        if not terms: return []
        match_query = " AND ".join(f'"{term.replace(chr(34), "")}"' for term in terms)
        try:
            rows = self.connection.execute("SELECT k.* FROM knowledge_items_fts f JOIN knowledge_items k ON k.id = f.id WHERE f.client_id = ? AND f.brand_id = ? AND f MATCH ? AND k.archive_state = 'active' AND k.review_state = 'approved' AND k.rights_state IN ('user_owned', 'licensed') ORDER BY k.id", (client_id, brand_id, match_query)).fetchall()
        except sqlite3.OperationalError:
            rows = self.connection.execute("SELECT * FROM knowledge_items WHERE client_id = ? AND brand_id = ? AND archive_state = 'active' AND review_state = 'approved' AND rights_state IN ('user_owned', 'licensed') AND (lower(title) LIKE ? OR lower(metadata_json) LIKE ?) ORDER BY title, id", (client_id, brand_id, f"%{query.lower()}%", f"%{query.lower()}%")).fetchall()
        return sorted(({"id": row["id"], "clientId": row["client_id"], "brandId": row["brand_id"], "title": row["title"], "contentHash": row["content_hash"], "provenance": row["provenance"], "rightsState": row["rights_state"], "reviewState": row["review_state"], "archiveState": row["archive_state"], **json.loads(row["metadata_json"])} for row in rows), key=lambda item: item["id"])

    def archive_knowledge_item(self, item_id: str) -> dict[str, str]:
        item_id = self._text(item_id, "KNOWLEDGE_ID_INVALID", 128)
        result = self.connection.execute("UPDATE knowledge_items SET archive_state = 'archived' WHERE id = ?", (item_id,))
        self.connection.commit()
        if result.rowcount != 1:
            raise StateValidationError("KNOWLEDGE_MISSING")
        return {"id": item_id, "archiveState": "archived"}

    def create_prompt_blueprint(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        version = value.get("version")
        if not isinstance(version, int) or version < 1:
            raise StateValidationError("PROMPT_BLUEPRINT_VERSION_INVALID")
        record = {"id": self._text(value.get("id"), "PROMPT_BLUEPRINT_ID_INVALID", 128), "brandId": self._text(value.get("brandId"), "PROMPT_BLUEPRINT_BRAND_MISSING", 128), "identityId": value.get("identityId"), "kind": self._text(value.get("kind"), "PROMPT_BLUEPRINT_KIND_INVALID", 80), "template": self._text(value.get("template"), "PROMPT_BLUEPRINT_TEMPLATE_INVALID", 6000), "version": version, "status": self._text(value.get("status"), "PROMPT_BLUEPRINT_STATUS_INVALID", 40)}
        self._row("SELECT id FROM brands WHERE id = ?", (record["brandId"],), "PROMPT_BLUEPRINT_BRAND_MISSING")
        identity_id = value.get("identityId")
        if identity_id:
            identity = self._row("SELECT brand_id FROM brand_identities WHERE id = ?", (self._text(identity_id, "PROMPT_BLUEPRINT_IDENTITY_INVALID", 128),), "PROMPT_BLUEPRINT_IDENTITY_MISSING")
            if identity["brand_id"] != record["brandId"]: raise StateValidationError("PROMPT_BLUEPRINT_IDENTITY_MISMATCH")
        self._insert("INSERT INTO prompt_blueprints(id, brand_id, identity_id, kind, template, version, status) VALUES (?, ?, ?, ?, ?, ?, ?)", (record["id"], record["brandId"], identity_id, record["kind"], record["template"], record["version"], record["status"]), "PROMPT_BLUEPRINT_CONFLICT")
        return record

    def resolve_prompt_blueprint(self, blueprint_id: str, brand_id: str) -> dict[str, Any] | None:
        row = self.connection.execute("SELECT id, brand_id, identity_id, kind, template, version, status FROM prompt_blueprints WHERE id = ? AND brand_id = ?", (self._text(blueprint_id, "PROMPT_BLUEPRINT_ID_INVALID", 128), self._text(brand_id, "PROMPT_BLUEPRINT_BRAND_MISSING", 128))).fetchone()
        if row is None: return None
        return {"id": row["id"], "brandId": row["brand_id"], "identityId": row["identity_id"], "kind": row["kind"], "template": row["template"], "version": row["version"], "status": row["status"]}

    def list_prompt_blueprints(self, brand_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT id, brand_id, identity_id, kind, template, version, status FROM prompt_blueprints WHERE brand_id = ? ORDER BY version DESC, id", (self._text(brand_id, "PROMPT_BLUEPRINT_BRAND_MISSING", 128),)).fetchall()
        return [{"id": row["id"], "brandId": row["brand_id"], "identityId": row["identity_id"], "kind": row["kind"], "template": row["template"], "version": row["version"], "status": row["status"]} for row in rows]

    def list_research_evidence(self, client_id: str, brand_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT id, client_id, brand_id, source_url, source_title, retrieved_at, summary, rights_state, review_state, source_type FROM research_evidence WHERE client_id = ?"
        values: list[Any] = [self._text(client_id, "RESEARCH_CLIENT_MISSING", 128)]
        if brand_id:
            query += " AND (brand_id = ? OR brand_id IS NULL)"
            values.append(self._text(brand_id, "RESEARCH_BRAND_MISSING", 128))
        query += " ORDER BY retrieved_at DESC, id"
        rows = self.connection.execute(query, tuple(values)).fetchall()
        return [self._research_evidence_record(row) for row in rows]

    @staticmethod
    def _research_evidence_record(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "clientId": row["client_id"], "brandId": row["brand_id"], "sourceUrl": row["source_url"], "sourceTitle": row["source_title"], "retrievedAt": row["retrieved_at"], "summary": row["summary"], "rightsState": row["rights_state"], "reviewState": row["review_state"], "sourceType": row["source_type"]}

    def create_research_evidence(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        retrieved_at = value.get("retrievedAt")
        if not isinstance(retrieved_at, str) or not retrieved_at or _parse_iso_date(retrieved_at) is None:
            raise StateValidationError("RESEARCH_RETRIEVED_AT_REQUIRED")
        if value.get("rightsState") not in {"user_owned", "licensed"} or value.get("reviewState") != "pending":
            raise StateValidationError("RIGHTS_OR_REVIEW_BLOCKED")
        source_type = value.get("sourceType", "operator_selected")
        if source_type not in {"operator_selected", "manual_entry"}:
            raise StateValidationError("RESEARCH_SOURCE_TYPE_INVALID")
        record = {"id": self._text(value.get("id"), "RESEARCH_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "RESEARCH_CLIENT_MISSING", 128), "brandId": value.get("brandId"), "sourceUrl": self._text(value.get("sourceUrl"), "RESEARCH_SOURCE_URL_REQUIRED", 4096), "sourceTitle": self._text(value.get("sourceTitle"), "RESEARCH_SOURCE_TITLE_REQUIRED"), "retrievedAt": retrieved_at, "summary": self._text(value.get("summary"), "RESEARCH_SUMMARY_REQUIRED"), "rightsState": value["rightsState"], "reviewState": value["reviewState"], "sourceType": source_type}
        if not record["sourceUrl"].startswith("https://"): raise StateValidationError("RESEARCH_SOURCE_URL_REQUIRED")
        brand_id = self._text(record["brandId"], "RESEARCH_BRAND_MISSING", 128) if record["brandId"] else None
        if brand_id:
            brand = self._row("SELECT client_id FROM brands WHERE id = ?", (brand_id,), "RESEARCH_BRAND_MISSING")
            if brand["client_id"] != record["clientId"]: raise StateValidationError("RIGHTS_OR_REVIEW_BLOCKED")
        self._insert("INSERT INTO research_evidence(id, client_id, brand_id, source_url, source_title, retrieved_at, summary, rights_state, review_state, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], brand_id, record["sourceUrl"], record["sourceTitle"], record["retrievedAt"], record["summary"], record["rightsState"], record["reviewState"], record["sourceType"]), "RESEARCH_CONFLICT")
        return record

    def approve_research_evidence(self, evidence_id: str, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        evidence_id = self._text(evidence_id, "RESEARCH_EVIDENCE_ID_INVALID", 128)
        brand_id = self._text(value.get("brandId"), "RESEARCH_BRAND_MISSING", 128)
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            brand = self._brand(brand_id)
            self._require_manage_brand(value.get("actor"), brand_id)
            evidence = self._row("SELECT * FROM research_evidence WHERE id = ?", (evidence_id,), "RESEARCH_EVIDENCE_MISSING")
            if brand["client_id"] != evidence["client_id"] or (evidence["brand_id"] and evidence["brand_id"] != brand_id):
                raise StateValidationError("RESEARCH_EVIDENCE_SCOPE_INVALID")
            if evidence["rights_state"] not in {"user_owned", "licensed"}:
                raise StateValidationError("RIGHTS_OR_REVIEW_BLOCKED")
            if evidence["review_state"] == "approved":
                result = evidence
            elif evidence["review_state"] == "pending":
                self.connection.execute("UPDATE research_evidence SET review_state = 'approved' WHERE id = ? AND review_state = 'pending'", (evidence_id,))
                result = self._row("SELECT * FROM research_evidence WHERE id = ?", (evidence_id,), "RESEARCH_EVIDENCE_MISSING")
            else:
                raise StateValidationError("RESEARCH_REVIEW_STATE_INVALID")
            self.connection.commit()
            return self._research_evidence_record(result)
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.DatabaseError as error:
            self.connection.rollback()
            raise StateValidationError("RESEARCH_APPROVAL_FAILED") from error

    def create_trend_signal(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        if any(key in value for key in ("prediction", "forecast", "probability")):
            raise StateValidationError("TREND_PREDICTION_FIELD_REJECTED")
        observed_at = value.get("observedAt")
        if not isinstance(observed_at, str) or _parse_iso_date(observed_at) is None: raise StateValidationError("TREND_OBSERVED_AT_INVALID")
        evidence_ids = value.get("evidenceIds", [])
        if not isinstance(evidence_ids, list) or not all(isinstance(item, str) and item for item in evidence_ids): raise StateValidationError("TREND_EVIDENCE_REQUIRED")
        record = {"id": self._text(value.get("id"), "TREND_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "TREND_CLIENT_MISSING", 128), "source": self._text(value.get("source"), "TREND_SOURCE_REQUIRED"), "observedAt": observed_at, "topic": self._text(value.get("topic"), "TREND_TOPIC_REQUIRED"), "metric": self._text(value.get("metric"), "TREND_METRIC_REQUIRED"), "evidenceIds": evidence_ids, "status": self._text(value.get("status"), "TREND_STATUS_INVALID", 40)}
        self._insert("INSERT INTO trend_signals(id, client_id, source, observed_at, topic, metric, evidence_ids_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["source"], record["observedAt"], record["topic"], record["metric"], json.dumps(evidence_ids, separators=(",", ":")), record["status"]), "TREND_CONFLICT")
        return record

    def list_trend_signals(self, client_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT id, client_id, source, observed_at, topic, metric, evidence_ids_json, status FROM trend_signals WHERE client_id = ? ORDER BY observed_at DESC, id", (self._text(client_id, "TREND_CLIENT_MISSING", 128),)).fetchall()
        return [{"id": row["id"], "clientId": row["client_id"], "source": row["source"], "observedAt": row["observed_at"], "topic": row["topic"], "metric": row["metric"], "evidenceIds": json.loads(row["evidence_ids_json"]), "status": row["status"]} for row in rows]

    def create_media_asset(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        self._reject_local_media_paths(value, "MEDIA_METADATA_PATH_REJECTED")
        metadata = value.get("metadata", {})
        if not isinstance(metadata, dict): raise StateValidationError("MEDIA_METADATA_INVALID")
        record = {"id": self._text(value.get("id"), "MEDIA_ID_INVALID", 128), "clientId": self._text(value.get("clientId"), "MEDIA_CLIENT_MISSING", 128), "brandId": self._text(value.get("brandId"), "MEDIA_BRAND_MISSING", 128), "source": self._text(value.get("source"), "MEDIA_SOURCE_INVALID", 40), "providerFileId": value.get("providerFileId"), "metadata": metadata, "archiveState": "active"}
        brand = self._row("SELECT client_id, deleted_at FROM brands WHERE id = ?", (record["brandId"],), "MEDIA_BRAND_MISSING")
        if brand["client_id"] != record["clientId"]: raise StateValidationError("MEDIA_CLIENT_MISMATCH")
        if brand["deleted_at"]: raise StateValidationError("BRAND_TRASHED")
        self._insert("INSERT INTO media_assets(id, client_id, brand_id, metadata_json) VALUES (?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], json.dumps({"source": record["source"], "providerFileId": record["providerFileId"], **metadata, "archiveState": "active"}, separators=(",", ":"))), "MEDIA_CONFLICT")
        return record

    def compensate_media_asset(self, asset_id: str, value: dict[str, Any]) -> dict[str, str]:
        """Check receipt, scope, adoption and committed references in one SQLite DELETE transaction."""
        self._validate_scalar(value)
        asset_id = self._text(asset_id, "MEDIA_ID_INVALID", 128)
        if set(value) != {"clientId", "brandId", "ownershipReceiptId", "sha256", "mimeType"}:
            raise StateValidationError("MEDIA_OWNERSHIP_RECEIPT_INVALID")
        client_id = self._text(value.get("clientId"), "MEDIA_CLIENT_MISSING", 128)
        brand_id = self._text(value.get("brandId"), "MEDIA_BRAND_MISSING", 128)
        receipt_id = self._text(value.get("ownershipReceiptId"), "MEDIA_OWNERSHIP_RECEIPT_INVALID", 128)
        digest = self._text(value.get("sha256"), "MEDIA_OWNERSHIP_RECEIPT_INVALID", 64).lower()
        mime_type = self._text(value.get("mimeType"), "MEDIA_OWNERSHIP_RECEIPT_INVALID", 128).lower()
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or not re.fullmatch(r"(?:image|video)/[a-z0-9.+-]+", mime_type):
            raise StateValidationError("MEDIA_OWNERSHIP_RECEIPT_INVALID")
        try:
            # ponytail: scan JSON references for local volumes; normalize reference edges if this becomes a bottleneck.
            removed = self.connection.execute("""
                DELETE FROM media_assets
                WHERE id = ? AND client_id = ? AND brand_id = ?
                  AND json_type(metadata_json) = 'object'
                  AND json_extract(metadata_json, '$.ownershipReceiptId') = ?
                  AND lower(json_extract(metadata_json, '$.sha256')) = ?
                  AND lower(json_extract(metadata_json, '$.mimeType')) = ?
                  AND coalesce(json_extract(metadata_json, '$.archiveState'), 'active') = 'active'
                  AND coalesce(json_extract(metadata_json, '$.distribution'), 'facebook') IN ('facebook', 'instagram', 'tiktok', 'youtube')
                  AND coalesce(json_extract(metadata_json, '$.shared'), 0) = 0
                  AND coalesce(json_type(metadata_json, '$.sharedBrandIds'), 'array') = 'array'
                  AND coalesce(json_array_length(metadata_json, '$.sharedBrandIds'), 0) = 0
                  AND coalesce(json_type(metadata_json, '$.shared_brand_ids'), 'array') = 'array'
                  AND coalesce(json_array_length(metadata_json, '$.shared_brand_ids'), 0) = 0
                  AND coalesce(json_extract(metadata_json, '$.usageStatus'), 'available') = 'available'
                  AND NOT EXISTS (
                    SELECT 1 FROM content_runs r WHERE NOT json_valid(r.payload_json)
                      OR json_type(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END) != 'object'
                      OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END) j WHERE j.value = media_assets.id)
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM publication_commands c WHERE NOT json_valid(c.command_json)
                      OR json_type(CASE WHEN json_valid(c.command_json) THEN c.command_json ELSE '{}' END) != 'object'
                      OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(c.command_json) THEN c.command_json ELSE '{}' END) j WHERE j.value = media_assets.id)
                  )
                RETURNING id
            """, (asset_id, client_id, brand_id, receipt_id, digest, mime_type)).fetchone()
            self.connection.commit()
        except sqlite3.DatabaseError:
            self.connection.rollback()
            return {"assetId": asset_id, "status": "retained", "reason": "MEDIA_OWNERSHIP_VERIFICATION_UNKNOWN"}
        if removed is not None:
            return {"assetId": asset_id, "status": "deleted"}
        exists = self.connection.execute("SELECT 1 FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
        if exists is None:
            return {"assetId": asset_id, "status": "absent"}
        return {"assetId": asset_id, "status": "retained", "reason": "MEDIA_OWNERSHIP_OR_REFERENCE_CHANGED"}

    def create_automation_plan(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        binding_ids = value.get("bindingIds", [])
        if not isinstance(binding_ids, list) or not all(isinstance(item, str) and item for item in binding_ids): raise StateValidationError("BINDING_IDS_INVALID")
        record = {"id": self._text(value.get("id"), "PLAN_ID_INVALID", 128), "brandId": self._text(value.get("brandId"), "PLAN_BRAND_MISSING", 128), "state": self._text(value.get("state"), "PLAN_STATE_INVALID", 40), "generationProfileId": value.get("generationProfileId"), "bindingIds": binding_ids}
        brand = self._row("SELECT id, deleted_at FROM brands WHERE id = ?", (record["brandId"],), "PLAN_BRAND_MISSING")
        if brand["deleted_at"]: raise StateValidationError("BRAND_TRASHED")
        if record["generationProfileId"] is not None:
            record["generationProfileId"] = self._text(record["generationProfileId"], "PLAN_PROFILE_INVALID", 128)
        payload = value.get("payload") if isinstance(value.get("payload"), dict) else value
        self._insert("INSERT INTO automation_plans(id, brand_id, state, generation_profile_id, binding_ids_json, payload_json) VALUES (?, ?, ?, ?, ?, ?)", (record["id"], record["brandId"], record["state"], record["generationProfileId"], json.dumps(binding_ids, separators=(",", ":")), json.dumps(payload, separators=(",", ":"))), "PLAN_CONFLICT")
        return record

    def update_automation_plan(self, plan_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(changes)
        plan_id = self._text(plan_id, "PLAN_ID_INVALID", 128)
        row = self._row("SELECT state, generation_profile_id, binding_ids_json, payload_json FROM automation_plans WHERE id = ?", (plan_id,), "PLAN_MISSING")
        state = self._text(changes.get("state", row["state"]), "PLAN_STATE_INVALID", 40)
        generation_profile_id = changes.get("generationProfileId", row["generation_profile_id"])
        if generation_profile_id is not None:
            generation_profile_id = self._text(generation_profile_id, "PLAN_PROFILE_INVALID", 128)
        binding_ids = changes.get("bindingIds")
        if binding_ids is None:
            try:
                binding_ids = json.loads(row["binding_ids_json"] or "[]")
            except json.JSONDecodeError:
                binding_ids = []
        if not isinstance(binding_ids, list) or not all(isinstance(item, str) and item for item in binding_ids):
            raise StateValidationError("BINDING_IDS_INVALID")
        try:
            existing_payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            existing_payload = {}
        if not isinstance(existing_payload, dict):
            existing_payload = {}
        incoming_payload = changes.get("payload")
        if incoming_payload is not None and not isinstance(incoming_payload, dict):
            raise StateValidationError("PLAN_PAYLOAD_INVALID")
        payload = {**existing_payload, **(incoming_payload or {})}
        previous_revision = payload.get("revision", 1)
        if not isinstance(previous_revision, int) or previous_revision < 1:
            previous_revision = 1
        revision = payload.get("revision", previous_revision)
        if not isinstance(revision, int) or revision < previous_revision:
            revision = previous_revision
        now = datetime.now(timezone.utc).isoformat()
        self.connection.execute("INSERT OR IGNORE INTO automation_plan_revisions(plan_id, revision, payload_json, created_at) VALUES (?, ?, ?, ?)", (plan_id, previous_revision, json.dumps(existing_payload, separators=(",", ":")), now))
        self.connection.execute("UPDATE automation_plans SET state = ?, generation_profile_id = ?, binding_ids_json = ?, payload_json = ? WHERE id = ?", (state, generation_profile_id, json.dumps(binding_ids, separators=(",", ":")), json.dumps(payload, separators=(",", ":")), plan_id))
        self.connection.commit()
        updated = self.list_entity("automation_plans", plan_id)[0]
        updated["payload"] = payload
        return updated

    def list_automation_plan_revisions(self, plan_id: str) -> list[dict[str, Any]]:
        plan_id = self._text(plan_id, "PLAN_ID_INVALID", 128)
        rows = self.connection.execute("SELECT id, plan_id, revision, payload_json, created_at FROM automation_plan_revisions WHERE plan_id = ? ORDER BY revision", (plan_id,)).fetchall()
        return [{"id": row["id"], "planId": row["plan_id"], "revision": row["revision"], "payload": json.loads(row["payload_json"] or "{}"), "createdAt": row["created_at"]} for row in rows]

    def create_automation_run(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        record = {"id": self._text(value.get("id"), "AUTOMATION_RUN_ID_INVALID", 128), "planId": self._text(value.get("planId"), "PLAN_MISSING", 128), "trigger": self._text(value.get("trigger"), "AUTOMATION_TRIGGER_INVALID", 40), "runDate": value.get("runDate"), "state": "needs_review"}
        review_only = value.get("reviewOnly") is True and record["trigger"] == "manual"
        if review_only:
            self._row("SELECT id FROM automation_plans WHERE id = ?", (record["planId"],), "PLAN_MISSING")
        else:
            self._row("SELECT id FROM automation_plans WHERE id = ? AND state = 'active'", (record["planId"],), "PLAN_NOT_ACTIVE")
        self._insert("INSERT INTO automation_runs(id, plan_id, state, trigger, run_date, payload_json) VALUES (?, ?, ?, ?, ?, ?)", (record["id"], record["planId"], record["state"], record["trigger"], record["runDate"], json.dumps(value, separators=(",", ":"))), "AUTOMATION_RUN_CONFLICT")
        return record

    def list_media_assets(self, client_id: str, brand_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT id, client_id, brand_id, metadata_json FROM media_assets WHERE client_id = ? ORDER BY id", (self._text(client_id, "MEDIA_CLIENT_MISSING", 128),)).fetchall()
        selected_brand = self._text(brand_id, "MEDIA_BRAND_MISSING", 128)
        result = []
        for row in rows:
            metadata = json.loads(row["metadata_json"] or "{}")
            if not isinstance(metadata, dict):
                metadata = {}
            if row["brand_id"] not in {selected_brand, None}:
                shared_brand_ids = metadata.get("sharedBrandIds") or metadata.get("shared_brand_ids")
                shared_with_brand = metadata.get("shared") is True or metadata.get("distribution") == "universal" or isinstance(shared_brand_ids, list) and selected_brand in shared_brand_ids
                if not shared_with_brand:
                    continue
            result.append({"id": row["id"], "clientId": row["client_id"], "brandId": row["brand_id"], **metadata})
        return result

    def archive_media_asset(self, asset_id: str) -> dict[str, str]:
        asset_id = self._text(asset_id, "MEDIA_ID_INVALID", 128)
        row = self._row("SELECT metadata_json FROM media_assets WHERE id = ?", (asset_id,), "MEDIA_MISSING")
        metadata = json.loads(row["metadata_json"])
        metadata["archiveState"] = "archived"
        self.connection.execute("UPDATE media_assets SET metadata_json = ? WHERE id = ?", (json.dumps(metadata, separators=(",", ":")), asset_id))
        self.connection.commit()
        provider_file_id = metadata.get("providerFileId")
        return {"id": asset_id, "archiveState": "archived", "providerFileId": provider_file_id} if isinstance(provider_file_id, str) else {"id": asset_id, "archiveState": "archived"}

    def restore_media_asset(self, asset_id: str) -> dict[str, str]:
        asset_id = self._text(asset_id, "MEDIA_ID_INVALID", 128)
        row = self._row("SELECT metadata_json FROM media_assets WHERE id = ?", (asset_id,), "MEDIA_MISSING")
        metadata = json.loads(row["metadata_json"] or "{}")
        metadata["archiveState"] = "active"
        metadata["status"] = "classified"
        metadata["reviewStatus"] = "needs_review"
        metadata["reviewedReady"] = False
        metadata["usageStatus"] = "available"
        self.connection.execute("UPDATE media_assets SET metadata_json = ? WHERE id = ?", (json.dumps(metadata, separators=(",", ":")), asset_id))
        self.connection.commit()
        return {"id": asset_id, "archiveState": "active"}

    def probe_generation_profile(self, profile_id: str) -> dict[str, Any]:
        row = self._row("SELECT id, provider, model, capabilities_json, status, secret_ref FROM generation_profiles WHERE id = ?", (self._text(profile_id, "PROFILE_ID_INVALID", 128),), "PROFILE_MISSING")
        status = row["status"]
        if status == "connected" and not row["secret_ref"] and row["provider"] not in {"gemini_web", "chatgpt_web"}:
            status = "not_configured"
        return {"id": row["id"], "provider": row["provider"], "model": row["model"], "capabilities": json.loads(row["capabilities_json"]), "status": status}

    def probe_provider_configuration(self, config_id: str, operator_approved: bool = False) -> dict[str, Any]:
        row = self._row("SELECT id, client_id, provider_kind, model, status, capabilities_json, secret_ref, metadata_json FROM provider_configurations WHERE id = ?", (self._text(config_id, "PROVIDER_ID_INVALID", 128),), "PROVIDER_MISSING")
        status = row["status"]
        error_code: str | None = None
        metadata = json.loads(row["metadata_json"] or "{}")
        checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        metadata["checkedAt"] = checked_at
        if row["provider_kind"] == "opencode_go":
            status = "review_required"
            error_code = "POLICY_CONFIRMATION_REQUIRED"
        elif not row["secret_ref"]:
            status = "not_configured"
            error_code = "PROVIDER_SECRET_REF_REQUIRED"
        elif row["provider_kind"] == "vertex_ai" and (not metadata.get("projectId") or not metadata.get("location")):
            status = "review_required"
            error_code = "PROVIDER_VERTEX_CONFIGURATION_REQUIRED"
        elif status != "connected" and operator_approved:
            status = "connected"
        elif status != "connected":
            status = "not_configured"
            error_code = "OPERATOR_APPROVAL_REQUIRED"
        else:
            status = "connected"
        self.connection.execute("UPDATE provider_configurations SET status = ?, metadata_json = ? WHERE id = ?", (status, json.dumps(metadata, separators=(",", ":")), row["id"]))
        self.connection.commit()
        return {"providerId": row["id"], "clientId": row["client_id"], "providerKind": row["provider_kind"], "model": row["model"], "capabilities": json.loads(row["capabilities_json"]), "status": status, "checkedAt": checked_at, **({"errorCode": error_code} if error_code else {})}

    def validate_plan_activation(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        binding_ids = value.get("bindingIds", [])
        if not isinstance(binding_ids, list) or not binding_ids: return {"ok": False, "code": "BINDINGS_REQUIRED"}
        placeholders = ",".join("?" for _ in binding_ids)
        rows = self.connection.execute(f"SELECT id, state FROM channel_bindings WHERE id IN ({placeholders})", tuple(binding_ids)).fetchall()
        if len(rows) != len(binding_ids) or any(row["state"] != "connected" for row in rows): return {"ok": False, "code": "BINDINGS_NOT_READY"}
        profile = self.probe_generation_profile(self._text(value.get("generationProfileId"), "PROFILE_MISSING", 128))
        if profile["status"] != "connected": return {"ok": False, "code": "LLM_PROVIDER_NOT_READY"}
        if profile.get("provider") in {"gemini_web", "chatgpt_web"} and value.get("appOpen") is not True: return {"ok": False, "code": "APP_OPEN_REQUIRED"}
        return {"ok": True, "code": "READY", "bindingCount": len(rows), "generationProfileId": profile["id"]}

    @staticmethod
    def target_publication_idempotency_key(client_id: str, brand_id: str, binding_id: str, variant_id: str, scheduled_slot: str) -> str:
        raw = "\x1f".join((client_id, brand_id, binding_id, variant_id, scheduled_slot))
        return sha256(raw.encode("utf-8")).hexdigest()

    def append_analytics_event(self, value: dict[str, Any]) -> dict[str, Any]:
        self._validate_scalar(value)
        allowed_events = {"content_run.created", "quality.checked", "telegram.prepared", "target_publication.entered_review", "approval.decided", "preflight.checked", "publication.state_changed", "worker.reconciled"}
        record = {"id": self._text(value.get("id"), "ANALYTICS_EVENT_ID_INVALID", 128), "eventName": self._text(value.get("eventName"), "ANALYTICS_EVENT_NAME_INVALID", 100), "clientId": self._text(value.get("clientId"), "ANALYTICS_CLIENT_MISSING", 128), "brandId": self._text(value.get("brandId"), "ANALYTICS_BRAND_MISSING", 128), "occurredAt": self._text(value.get("occurredAt"), "ANALYTICS_OCCURRED_AT_INVALID", 80), "properties": value.get("properties", {})}
        if record["eventName"] not in allowed_events: raise StateValidationError("ANALYTICS_EVENT_NAME_INVALID")
        if not isinstance(record["properties"], dict): raise StateValidationError("ANALYTICS_PROPERTIES_INVALID")
        if _parse_iso_date(record["occurredAt"]) is None: raise StateValidationError("ANALYTICS_OCCURRED_AT_INVALID")
        if "simulation" in record["properties"] and not isinstance(record["properties"]["simulation"], bool): raise StateValidationError("ANALYTICS_SIMULATION_INVALID")
        brand = self._row("SELECT client_id FROM brands WHERE id = ?", (record["brandId"],), "ANALYTICS_BRAND_MISSING")
        if brand["client_id"] != record["clientId"]: raise StateValidationError("ANALYTICS_CLIENT_MISMATCH")
        self._insert("INSERT INTO analytics_events(id, client_id, brand_id, event_name, occurred_at, properties_json) VALUES (?, ?, ?, ?, ?, ?)", (record["id"], record["clientId"], record["brandId"], record["eventName"], record["occurredAt"], json.dumps(record["properties"], separators=(",", ":"))), "ANALYTICS_EVENT_CONFLICT")
        return record

    def list_analytics_events(self, client_id: str, brand_id: str) -> list[dict[str, Any]]:
        client_id = self._text(client_id, "ANALYTICS_CLIENT_MISSING", 128)
        brand_id = self._text(brand_id, "ANALYTICS_BRAND_MISSING", 128)
        legacy_ids = {row["id"] for row in self.connection.execute("SELECT id FROM target_publications WHERE client_id = ? AND brand_id = ? AND (simulation = 1 OR legacy_non_live = 1)", (client_id, brand_id)).fetchall()}
        rows = self.connection.execute("SELECT id, event_name, client_id, brand_id, occurred_at, properties_json FROM analytics_events WHERE client_id = ? AND brand_id = ? ORDER BY occurred_at, id", (client_id, brand_id)).fetchall()
        events = []
        for row in rows:
            properties = json.loads(row["properties_json"])
            if properties.get("simulation") is True or any(isinstance(properties.get(key), str) and properties.get(key) in legacy_ids for key in ("targetPublicationId", "target_publication_id", "publicationId", "publication_id")):
                continue
            events.append({"id": row["id"], "eventName": row["event_name"], "clientId": row["client_id"], "brandId": row["brand_id"], "occurredAt": row["occurred_at"], "properties": properties})
        return events

    def list_target_publications(self, client_id: str, brand_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute("SELECT p.id, p.binding_id, p.variant_id, p.idempotency_key, p.approval_state, p.state, p.client_id, p.brand_id, p.simulation, p.legacy_non_live, p.terminal_at, p.provider_call_count, p.provider_job_id, p.scheduled_at, p.target_external_id, p.target_platform, p.plan_id, p.content_run_id, p.revision, p.worker_job_id, p.worker_revision, p.pending_command_id, p.worker_ack_state, (SELECT c.status FROM publication_commands c WHERE c.publication_id = p.id ORDER BY c.created_at DESC, c.request_id DESC LIMIT 1) AS command_status, (SELECT c.error_code FROM publication_commands c WHERE c.publication_id = p.id ORDER BY c.created_at DESC, c.request_id DESC LIMIT 1) AS command_error FROM target_publications p WHERE p.client_id = ? AND p.brand_id = ? ORDER BY p.id", (self._text(client_id, "TARGET_PUBLICATION_CLIENT_MISSING", 128), self._text(brand_id, "TARGET_PUBLICATION_BRAND_MISSING", 128))).fetchall()
        return [{"id": row["id"], "bindingId": row["binding_id"], "variantId": row["variant_id"], "idempotencyKey": row["idempotency_key"], "approvalState": row["approval_state"], "state": row["state"], "clientId": row["client_id"], "brandId": row["brand_id"], "simulation": bool(row["simulation"]), "legacyNonLive": bool(row["legacy_non_live"]), "terminalAt": row["terminal_at"], "providerCallCount": row["provider_call_count"], "providerJobId": row["provider_job_id"], "scheduledAt": row["scheduled_at"], "targetExternalId": row["target_external_id"], "targetPlatform": row["target_platform"], "planId": row["plan_id"], "contentRunId": row["content_run_id"], "revision": row["revision"], "workerJobId": row["worker_job_id"], "workerRevision": row["worker_revision"], "pendingCommandId": row["pending_command_id"], "workerAckState": row["worker_ack_state"], "commandStatus": row["command_status"], "commandError": row["command_error"]} for row in rows]

    def reconcile_target_publication(self, publication_id: str, state: str, provider_job_id: str | None = None, provider_call_count: int | None = None) -> dict[str, Any]:
        publication_id = self._text(publication_id, "TARGET_PUBLICATION_ID_INVALID", 128)
        row = self._row("SELECT provider_call_count, simulation, legacy_non_live FROM target_publications WHERE id = ?", (publication_id,), "TARGET_PUBLICATION_MISSING")
        if bool(row["simulation"]) or bool(row["legacy_non_live"]):
            raise StateValidationError("LEGACY_NON_LIVE_ACTION_BLOCKED")
        if state not in {"scheduled", "queued", "processing", "published", "retryable_error", "permanent_error", "blocked"}:
            raise StateValidationError("TARGET_PUBLICATION_STATE_INVALID")
        calls = row["provider_call_count"] if provider_call_count is None else provider_call_count
        if not isinstance(calls, int) or calls < 0:
            raise StateValidationError("TARGET_PUBLICATION_CALL_COUNT_INVALID")
        terminal_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z") if state in {"published", "permanent_error", "blocked"} else None
        self.connection.execute("UPDATE target_publications SET state = ?, terminal_at = ?, provider_call_count = ?, provider_job_id = COALESCE(?, provider_job_id) WHERE id = ?", (state, terminal_at, calls, provider_job_id, publication_id))
        self.connection.commit()
        return {"id": publication_id, "state": state, "terminalAt": terminal_at, "providerCallCount": calls, **({"providerJobId": provider_job_id} if provider_job_id else {})}

    def latest_analytics_time(self) -> str | None:
        row = self.connection.execute("SELECT MAX(occurred_at) AS occurred_at FROM analytics_events").fetchone()
        return row["occurred_at"] if row and row["occurred_at"] else None

    def latest_worker_reconciled_time(self) -> str | None:
        row = self.connection.execute("SELECT MAX(occurred_at) AS occurred_at FROM analytics_events WHERE event_name = 'worker.reconciled'").fetchone()
        return row["occurred_at"] if row and row["occurred_at"] else None

    def control_plane_migrated(self) -> bool:
        row = self.connection.execute("SELECT value FROM control_plane_metadata WHERE key = 'control_plane_migrated'").fetchone()
        return row is not None and row["value"] == "true"

    def commit_renderer_migration(self, value: dict[str, Any]) -> dict[str, int | bool]:
        self._validate_scalar(value)
        if self.control_plane_migrated():
            raise StateValidationError("RENDERER_STATE_REPLACEMENT_REJECTED")
        clients = value.get("clients", [])
        brands = value.get("brands", [])
        identities = value.get("identities", [])
        connections = value.get("connections", [])
        bindings = value.get("bindings", [])
        if not all(isinstance(items, list) for items in (clients, brands, identities, connections, bindings)):
            raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
        migration_saved_at = value.get("savedAt", value.get("migrationTimestamp"))
        if migration_saved_at is not None and (not isinstance(migration_saved_at, str) or _parse_iso_date(migration_saved_at) is None):
            raise StateValidationError("MIGRATION_TIMESTAMP_INVALID")
        migration_saved_at = migration_saved_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        seen_brand_clients: dict[str, str] = {}
        for item in brands:
            if not isinstance(item, dict):
                raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
            brand_id = self._text(item.get("id"), "BRAND_ID_INVALID", 128)
            client_id = self._text(item.get("clientId"), "BRAND_CLIENT_MISSING", 128)
            prior_client = seen_brand_clients.get(brand_id)
            if prior_client is not None:
                raise StateValidationError("BRAND_ID_SCOPE_CONFLICT" if prior_client != client_id else "BRAND_CONFLICT")
            seen_brand_clients[brand_id] = client_id
        seen_identity_ids: set[str] = set()
        for item in identities:
            if not isinstance(item, dict):
                raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
            identity_id = self._text(item.get("id"), "IDENTITY_ID_INVALID", 128)
            if identity_id in seen_identity_ids:
                raise StateValidationError("IDENTITY_CONFLICT")
            seen_identity_ids.add(identity_id)
        migration_actor = self._actor_binding_from_payload(value)
        actor_bindings = value.get("actorBindings", [])
        if not isinstance(actor_bindings, list):
            raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
        actor_binding_by_brand: dict[str, tuple[str, str, list[str]]] = {}
        for item in actor_bindings:
            if not isinstance(item, dict):
                raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
            brand_id = self._text(item.get("brandId"), "BRAND_ID_INVALID", 128)
            actor_binding = self._actor_binding_from_payload(item)
            if actor_binding is None:
                raise StateValidationError("BRAND_ACTOR_REQUIRED")
            actor_binding_by_brand[brand_id] = actor_binding
        brand_specs = {str(item.get("id")): item for item in brands if isinstance(item, dict)}
        for item in identities:
            strategy_catalog = item.get("strategyCatalog")
            if strategy_catalog is None:
                continue
            identity_brand_id = self._text(item.get("brandId"), "IDENTITY_BRAND_MISSING", 128)
            if not bool(item.get("isDefault")):
                raise StateValidationError("STRATEGY_CATALOG_IDENTITY_NONCANONICAL")
            brand_spec = brand_specs.get(identity_brand_id)
            if brand_spec is None:
                raise StateValidationError("IDENTITY_BRAND_MISSING")
            if item.get("clientId") is not None and item.get("clientId") != brand_spec.get("clientId"):
                raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
            if brand_spec.get("status") != "active" or brand_spec.get("deletedAt"):
                raise StateValidationError("STRATEGY_CATALOG_BRAND_NOT_ACTIVE")
            if actor_binding_by_brand.get(identity_brand_id) is None and migration_actor is None:
                raise StateValidationError("BRAND_ACTOR_REQUIRED")
            _validate_strategy_catalog(strategy_catalog, identity_brand_id, allow_reduced_objectives=True)
            self._validate_strategy_catalog_recipe_registry(strategy_catalog)
        strategy_catalog_count = 0
        try:
            self.connection.execute("BEGIN")
            for item in clients:
                if not isinstance(item, dict): raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                self.connection.execute("INSERT INTO clients(id, name, timezone, status) VALUES (?, ?, ?, ?)", (self._text(item.get("id"), "CLIENT_ID_INVALID", 128), self._text(item.get("name"), "CLIENT_NAME_INVALID"), self._text(item.get("timezone"), "CLIENT_TIMEZONE_INVALID", 100), self._text(item.get("status"), "CLIENT_STATUS_INVALID", 40)))
            for item in brands:
                if not isinstance(item, dict): raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                brand_id = self._text(item.get("id"), "BRAND_ID_INVALID", 128)
                existing_brand = self.connection.execute("SELECT client_id FROM brands WHERE id = ?", (brand_id,)).fetchone()
                if existing_brand is not None:
                    raise StateValidationError("BRAND_ID_SCOPE_CONFLICT" if existing_brand["client_id"] != item.get("clientId") else "BRAND_CONFLICT")
                status = self._text(item.get("status"), "BRAND_STATUS_INVALID", 40)
                deleted_at = item.get("deletedAt")
                if status == "archived" and deleted_at is None:
                    deleted_at = migration_saved_at
                if deleted_at is not None:
                    deleted_at = self._text(deleted_at, "BRAND_DELETED_AT_INVALID", 80)
                    if _parse_iso_date(deleted_at) is None:
                        raise StateValidationError("BRAND_DELETED_AT_INVALID")
                self.connection.execute("INSERT INTO brands(id, client_id, name, status, deleted_at) VALUES (?, ?, ?, ?, ?)", (brand_id, self._text(item.get("clientId"), "BRAND_CLIENT_MISSING", 128), self._text(item.get("name"), "BRAND_NAME_INVALID"), status, deleted_at))
                actor_binding = actor_binding_by_brand.get(brand_id) or migration_actor
                if any(isinstance(item.get("strategyCatalog"), dict) for item in identities if isinstance(item, dict) and item.get("brandId") == brand_id) and actor_binding is None:
                    raise StateValidationError("BRAND_ACTOR_REQUIRED")
                if actor_binding is not None:
                    actor_user_id, role, capabilities = actor_binding
                    self.connection.execute("INSERT INTO brand_actor_bindings(brand_id, actor_user_id, role, capabilities_json) VALUES (?, ?, ?, ?)", (brand_id, actor_user_id, role, json.dumps(capabilities, separators=(",", ":"))))
            for item in identities:
                if not isinstance(item, dict): raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                version = item.get("version")
                if not isinstance(version, int) or version < 1: raise StateValidationError("IDENTITY_VERSION_INVALID")
                identity_brand_id = self._text(item.get("brandId"), "IDENTITY_BRAND_MISSING", 128)
                identity_brand = self._row("SELECT client_id, status, deleted_at FROM brands WHERE id = ?", (identity_brand_id,), "IDENTITY_BRAND_MISSING")
                if item.get("clientId") is not None and item.get("clientId") != identity_brand["client_id"]:
                    raise StateValidationError("IDENTITY_CLIENT_MISMATCH")
                if "catalog" in item:
                    raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                if item.get("strategyCatalog") is not None and not bool(item.get("isDefault")):
                    raise StateValidationError("STRATEGY_CATALOG_IDENTITY_NONCANONICAL")
                payload = {key: item[key] for key in ("strategy", "voice", "visual") if key in item}
                strategy_catalog = item.get("strategyCatalog")
                if strategy_catalog is not None:
                    if not bool(item.get("isDefault")):
                        raise StateValidationError("STRATEGY_CATALOG_IDENTITY_NONCANONICAL")
                    if identity_brand["client_id"] != item.get("clientId", identity_brand["client_id"]):
                        raise StateValidationError("STRATEGY_CATALOG_SCOPE_MISMATCH")
                    if identity_brand["status"] != "active" or identity_brand["deleted_at"]:
                        raise StateValidationError("STRATEGY_CATALOG_BRAND_NOT_ACTIVE")
                    if identity_brand["status"] == "active" and not identity_brand["deleted_at"]:
                        _validate_strategy_catalog(strategy_catalog, identity_brand_id, allow_reduced_objectives=True)
                        self._validate_strategy_catalog_recipe_registry(strategy_catalog)
                        payload["strategyCatalog"] = strategy_catalog
                        payload["strategyCatalogRevision"] = 0
                        strategy_catalog_count += 1
                self.connection.execute("INSERT INTO brand_identities(id, brand_id, name, is_default, version, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)", (self._text(item.get("id"), "IDENTITY_ID_INVALID", 128), identity_brand_id, self._text(item.get("name"), "IDENTITY_NAME_INVALID"), int(bool(item.get("isDefault"))), version, self._text(item.get("status"), "IDENTITY_STATUS_INVALID", 40), json.dumps(payload, separators=(",", ":"))))
            for item in connections:
                if not isinstance(item, dict): raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                scopes = item.get("scopes", [])
                if not isinstance(scopes, list) or not all(isinstance(scope, str) for scope in scopes): raise StateValidationError("CONNECTION_SCOPES_INVALID")
                secret_ref = item.get("secretRef")
                if secret_ref is not None and (not isinstance(secret_ref, str) or not re.fullmatch(r"(?:env|keychain):[A-Za-z0-9/_:.+-]{1,240}", secret_ref)): raise StateValidationError("CONNECTION_SECRET_REF_INVALID")
                self.connection.execute("INSERT INTO connections(id, client_id, platform, external_account_id, display_name, connection_state, scopes_json, secret_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (self._text(item.get("id"), "CONNECTION_ID_INVALID", 128), self._text(item.get("clientId"), "CONNECTION_CLIENT_MISSING", 128), self._text(item.get("platform"), "CONNECTION_PLATFORM_INVALID", 40), self._text(item.get("externalAccountId"), "CONNECTION_ACCOUNT_INVALID", 128), self._text(item.get("displayName"), "CONNECTION_NAME_INVALID"), self._text(item.get("connectionState"), "CONNECTION_STATE_INVALID", 40), json.dumps(scopes, separators=(",", ":")), secret_ref))
            for item in bindings:
                if not isinstance(item, dict): raise StateValidationError("MIGRATION_PAYLOAD_INVALID")
                brand_id = self._text(item.get("brandId"), "BINDING_BRAND_ID_INVALID", 160)
                identity_id = self._text(item.get("identityId"), "BINDING_IDENTITY_ID_INVALID", 160)
                connection_id = self._text(item.get("connectionId"), "BINDING_CONNECTION_ID_INVALID", 160)
                brand = self._row("SELECT client_id FROM brands WHERE id = ?", (brand_id,), "BINDING_BRAND_MISSING")
                identity = self._row("SELECT brand_id FROM brand_identities WHERE id = ?", (identity_id,), "BINDING_IDENTITY_MISMATCH")
                connection = self._row("SELECT client_id FROM connections WHERE id = ?", (connection_id,), "BINDING_CONNECTION_MISSING")
                if identity["brand_id"] != brand_id: raise StateValidationError("BINDING_IDENTITY_MISMATCH")
                if connection["client_id"] != brand["client_id"]: raise StateValidationError("CONNECTION_CLIENT_MISMATCH")
                self.connection.execute("INSERT INTO channel_bindings(id, brand_id, identity_id, connection_id, target_external_id, target_name, state) VALUES (?, ?, ?, ?, ?, ?, ?)", (self._text(item.get("id"), "BINDING_ID_INVALID", 160), brand_id, identity_id, connection_id, self._text(item.get("targetExternalId"), "BINDING_TARGETEXTERNALID_INVALID", 160), self._text(item.get("targetName"), "BINDING_TARGETNAME_INVALID", 160), self._text(item.get("state"), "BINDING_STATE_INVALID", 160)))
            self.connection.execute("INSERT OR REPLACE INTO control_plane_metadata(key, value) VALUES ('control_plane_migrated', 'true')")
            self.connection.execute("INSERT OR REPLACE INTO control_plane_metadata(key, value) VALUES ('strategy_catalog_schema_version', '5')")
            self.connection.commit()
        except (sqlite3.IntegrityError, StateValidationError) as error:
            self.connection.rollback()
            if isinstance(error, StateValidationError):
                raise
            raise StateValidationError("MIGRATION_CONFLICT") from error
        result: dict[str, int | bool] = {"controlPlaneMigrated": True, "clientCount": len(clients), "brandCount": len(brands), "identityCount": len(identities), "bindingCount": len(bindings)}
        binding_count = sum(1 for item in brands if isinstance(item, dict) and (str(item.get("id")) in actor_binding_by_brand or migration_actor is not None))
        if binding_count:
            result["actorBindingCount"] = binding_count
        if strategy_catalog_count:
            result["strategyCatalogCount"] = strategy_catalog_count
        return result

    def recovery_state(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "clients": self.list_entity("clients"),
            "brands": self.list_entity("brands"),
            "identities": self.list_entity("brand_identities"),
            "bindings": self.list_entity("channel_bindings"),
        }

    _ENTITY_COLUMNS = {
        "clients": {"name", "timezone", "status"},
        "brands": {"client_id", "name", "status"},
        "brand_identities": {"name", "is_default", "version", "status"},
        "channel_bindings": {"identity_id", "connection_id", "target_external_id", "target_name", "state"},
        "connections": {"platform", "external_account_id", "display_name", "connection_state", "scopes_json"},
        "generation_profiles": {"provider", "model", "capabilities_json", "status"},
        "content_runs": {"execution_mode", "provider_attempted", "recipe_id", "payload_json"},
        "target_publications": {"approval_state", "state", "terminal_at", "provider_call_count", "provider_job_id"},
        "provider_configurations": {"provider_kind", "display_name", "model", "status", "capabilities_json", "metadata_json"},
        "prompt_blueprints": {"kind", "template", "version", "status"},
        "research_evidence": {"source_url", "source_title", "retrieved_at", "summary", "rights_state", "source_type"},
        "trend_signals": {"source", "observed_at", "topic", "metric", "evidence_ids_json", "status"},
        "analytics_events": {"event_name", "occurred_at", "properties_json"},
        "audit_events": {"event_name", "occurred_at", "properties_json"},
        "media_assets": {"metadata_json"},
        "automation_plans": {"state"},
        "automation_runs": {"state"},
    }

    def list_entity(self, entity: str, record_id: str | None = None) -> list[dict[str, Any]]:
        if entity not in self._ENTITY_COLUMNS:
            raise StateValidationError("ENTITY_UNSUPPORTED")
        query = f"SELECT * FROM {entity}" + (" WHERE id = ?" if record_id else "") + " ORDER BY id"
        rows = self.connection.execute(query, (record_id,) if record_id else ()).fetchall()
        return [self._scalar_row(row, normalize_content_run_media_revision=entity == "content_runs") for row in rows]

    def update_entity(self, entity: str, record_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        if entity == "target_publications":
            raise StateValidationError("TARGET_PUBLICATION_COMMAND_REQUIRED")
        if entity == "brands":
            raise StateValidationError("BRAND_LIFECYCLE_REQUIRED")
        if entity not in self._ENTITY_COLUMNS:
            raise StateValidationError("ENTITY_UNSUPPORTED")
        if entity in {"analytics_events", "audit_events"}:
            raise StateValidationError("APPEND_ONLY_ENTITY")
        self._validate_scalar(changes)
        normalized = {self._snake_case(key): value for key, value in changes.items()}
        allowed = self._ENTITY_COLUMNS[entity]
        if not normalized or any(key not in allowed for key in normalized):
            raise StateValidationError("ENTITY_UPDATE_INVALID")
        values: list[Any] = []
        for key, value in normalized.items():
            if key == "is_default":
                value = int(bool(value))
            elif key == "version" and (not isinstance(value, int) or value < 1):
                raise StateValidationError("IDENTITY_VERSION_INVALID")
            else:
                value = self._text(value, "ENTITY_UPDATE_INVALID")
            values.append(value)
        try:
            result = self.connection.execute(f"UPDATE {entity} SET {', '.join(f'{key} = ?' for key in normalized)} WHERE id = ?", (*values, self._text(record_id, "ENTITY_ID_INVALID", 128)))
            self.connection.commit()
        except sqlite3.IntegrityError as error:
            raise StateValidationError("ENTITY_UPDATE_CONFLICT") from error
        if result.rowcount != 1:
            raise StateValidationError("ENTITY_MISSING")
        return self.list_entity(entity, record_id)[0]

    def delete_entity(self, entity: str, record_id: str) -> None:
        if entity == "media_assets":
            raise StateValidationError("MEDIA_OWNERSHIP_COMMAND_REQUIRED")
        if entity == "target_publications":
            raise StateValidationError("TARGET_PUBLICATION_COMMAND_REQUIRED")
        if entity == "brands":
            raise StateValidationError("BRAND_LIFECYCLE_REQUIRED")
        if entity not in self._ENTITY_COLUMNS:
            raise StateValidationError("ENTITY_UNSUPPORTED")
        if entity in {"analytics_events", "audit_events"}:
            raise StateValidationError("APPEND_ONLY_ENTITY")
        try:
            result = self.connection.execute(f"DELETE FROM {entity} WHERE id = ?", (self._text(record_id, "ENTITY_ID_INVALID", 128),))
            self.connection.commit()
        except sqlite3.IntegrityError as error:
            raise StateValidationError("ENTITY_IN_USE") from error
        if result.rowcount != 1:
            raise StateValidationError("ENTITY_MISSING")

    def trash_brand(self, brand_id: str, actor: dict[str, Any] | None = None) -> dict[str, Any]:
        brand_id = self._text(brand_id, "BRAND_ID_INVALID", 128)
        self._require_manage_brand(actor, brand_id)
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            brand = self._brand(brand_id)
            if self._brand_publication_blockers(brand["id"]):
                raise StateValidationError("BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED")
            counts = self._brand_impact_counts(brand["id"])
            deleted_at = brand["deleted_at"] or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            self.connection.execute("UPDATE brands SET status = 'archived', deleted_at = ? WHERE id = ?", (deleted_at, brand["id"]))
            self.connection.execute("UPDATE automation_plans SET state = 'paused' WHERE brand_id = ?", (brand["id"],))
            for row in self.connection.execute("SELECT id, payload_json FROM automation_plans WHERE brand_id = ?", (brand["id"],)).fetchall():
                try:
                    payload = json.loads(row["payload_json"] or "{}")
                except json.JSONDecodeError:
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                payload["state"] = "paused"
                self.connection.execute("UPDATE automation_plans SET payload_json = ? WHERE id = ?", (json.dumps(payload, separators=(",", ":")), row["id"]))
            self.connection.commit()
        except StateValidationError:
            self.connection.rollback()
            raise
        except sqlite3.Error as error:
            self.connection.rollback()
            raise StateValidationError("BRAND_TRASH_PENDING") from error
        return {"id": brand["id"], "clientId": brand["client_id"], "name": brand["name"], "status": "archived", "deletedAt": deleted_at, "pausedPlans": counts["planCount"], "canceledPublications": 0, **counts}

    def restore_brand(self, brand_id: str, actor: dict[str, Any] | None = None) -> dict[str, Any]:
        brand_id = self._text(brand_id, "BRAND_ID_INVALID", 128)
        self._require_manage_brand(actor, brand_id)
        brand = self._brand(brand_id)
        if not self._brand_is_trashed(brand):
            raise StateValidationError("BRAND_NOT_TRASHED")
        self.connection.execute("UPDATE brands SET status = 'draft', deleted_at = NULL WHERE id = ?", (brand["id"],))
        self.connection.commit()
        return {"id": brand["id"], "clientId": brand["client_id"], "name": brand["name"], "status": "draft", "deletedAt": None, "plansReactivated": False}

    def permanently_delete_brand(self, brand_id: str, confirmation: str | None = None, actor: dict[str, Any] | None = None) -> dict[str, Any]:
        brand_id = self._text(brand_id, "BRAND_ID_INVALID", 128)
        self._require_manage_brand(actor, brand_id)
        expected_impact_revision = actor.get("expectedImpactRevision") if isinstance(actor, dict) else None
        if expected_impact_revision is None and isinstance(actor, dict):
            expected_impact_revision = actor.get("expected_impact_revision")
        if expected_impact_revision is not None and (not isinstance(expected_impact_revision, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_impact_revision)):
            raise StateValidationError("BRAND_IMPACT_REVISION_INVALID")
        with _BRAND_DELETE_LOCK:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                brand = self._brand(brand_id)
                if not self._brand_is_trashed(brand):
                    raise StateValidationError("BRAND_NOT_TRASHED")
                if not isinstance(confirmation, str) or confirmation != brand["name"]:
                    raise StateValidationError("BRAND_NAME_CONFIRMATION_REQUIRED")
                blockers = self._brand_publication_blockers(brand["id"])
                counts = self._brand_impact_counts(brand["id"])
                current_impact_revision = self._brand_impact_revision(brand, counts, blockers)
                if expected_impact_revision is not None and expected_impact_revision != current_impact_revision:
                    raise StateValidationError("BRAND_IMPACT_CHANGED")
                if blockers:
                    raise StateValidationError("BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED")
                existing_operation = self.connection.execute("SELECT id, state FROM brand_deletion_operations WHERE brand_id = ? AND state IN ('pending', 'running') ORDER BY requested_at DESC, id DESC LIMIT 1", (brand["id"],)).fetchone()
                operation_id = str(existing_operation["id"]) if existing_operation is not None else f"brand-delete-{brand['id']}-{uuid.uuid4().hex}"
                if existing_operation is None:
                    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    self.connection.execute("INSERT INTO brand_deletion_operations(id, brand_id, client_id, state, phase, requested_at, updated_at) VALUES (?, ?, ?, 'pending', 'started', ?, ?)", (operation_id, brand["id"], brand["client_id"], now, now))
                self.connection.commit()
            except StateValidationError:
                self.connection.rollback()
                raise
            except sqlite3.Error as error:
                self.connection.rollback()
                raise StateValidationError("BRAND_DELETE_PENDING") from error

            published_remote_posts = self.connection.execute("SELECT COUNT(*) AS count FROM target_publications WHERE brand_id = ? AND state = 'published'", (brand["id"],)).fetchone()["count"]
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                current = self._brand(brand["id"])
                if not self._brand_is_trashed(current):
                    raise StateValidationError("BRAND_NOT_TRASHED")
                blockers = self._brand_publication_blockers(brand["id"])
                counts = self._brand_impact_counts(brand["id"])
                current_impact_revision = self._brand_impact_revision(current, counts, blockers)
                if expected_impact_revision is not None and expected_impact_revision != current_impact_revision:
                    raise StateValidationError("BRAND_IMPACT_CHANGED")
                if blockers:
                    raise StateValidationError("BRAND_PUBLICATIONS_RECONCILIATION_REQUIRED")
                shared_media_ids: list[str] = []
                for row in self.connection.execute("SELECT id, metadata_json FROM media_assets WHERE brand_id = ?", (brand["id"],)).fetchall():
                    try:
                        metadata = json.loads(row["metadata_json"] or "{}")
                    except json.JSONDecodeError:
                        metadata = None
                    if metadata is None or not isinstance(metadata, dict) or self._shared_media_metadata(metadata) or self._media_asset_referenced_by_other_scope(str(row["id"]), brand["id"]):
                        shared_media_ids.append(str(row["id"]))
                self.connection.execute("DELETE FROM publication_commands WHERE publication_id IN (SELECT id FROM target_publications WHERE brand_id = ?)", (brand["id"],))
                self.connection.execute("DELETE FROM target_publications WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM automation_runs WHERE plan_id IN (SELECT id FROM automation_plans WHERE brand_id = ?)", (brand["id"],))
                self.connection.execute("DELETE FROM automation_plan_revisions WHERE plan_id IN (SELECT id FROM automation_plans WHERE brand_id = ?)", (brand["id"],))
                self.connection.execute("DELETE FROM content_runs WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM prompt_blueprints WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM automation_plans WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM channel_bindings WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM knowledge_items_fts WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM knowledge_items WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM research_evidence WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM generation_profiles WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM analytics_events WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM audit_events WHERE brand_id = ?", (brand["id"],))
                if shared_media_ids:
                    placeholders = ",".join("?" for _ in shared_media_ids)
                    self.connection.execute(f"UPDATE media_assets SET brand_id = NULL WHERE id IN ({placeholders})", tuple(shared_media_ids))
                self.connection.execute("DELETE FROM media_assets WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM brand_identities WHERE brand_id = ?", (brand["id"],))
                self.connection.execute("DELETE FROM brands WHERE id = ?", (brand["id"],))
                completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                self.connection.execute("UPDATE brand_deletion_operations SET state = 'completed', phase = 'complete', completed_at = ?, updated_at = ?, error_code = NULL WHERE id = ?", (completed_at, completed_at, operation_id))
                self.connection.commit()
            except StateValidationError:
                self.connection.rollback()
                raise
            except sqlite3.Error as error:
                self.connection.rollback()
                raise StateValidationError("BRAND_DELETE_PENDING") from error
            remaining_brand_count = self.connection.execute("SELECT COUNT(*) AS count FROM brands WHERE client_id = ?", (brand["client_id"],)).fetchone()["count"]
            return {"id": brand["id"], "clientId": brand["client_id"], "name": brand["name"], "status": "deleted", "operationId": operation_id, "publishedRemotePosts": int(published_remote_posts), "publishedRemotePostsAction": "untouched", "sharedMedia": "untouched", "sharedMediaCount": len(shared_media_ids), "preservedSharedMediaIds": shared_media_ids, "sharedMediaAction": "untouched", "remainingBrandCount": int(remaining_brand_count)}

    @staticmethod
    def _snake_case(value: str) -> str:
        return re.sub(r"(?<!^)([A-Z])", r"_\1", value).lower()

    @staticmethod
    def _scalar_row(row: sqlite3.Row, *, normalize_content_run_media_revision: bool = False) -> dict[str, Any]:
        result = dict(row)
        result.pop("secret_ref", None)
        if "deleted_at" in result:
            result["deletedAt"] = result["deleted_at"]
        payload_json = result.pop("payload_json", None)
        if isinstance(payload_json, str):
            try:
                payload = json.loads(payload_json)
                if isinstance(payload, dict): result.update(payload)
            except json.JSONDecodeError:
                pass
        if normalize_content_run_media_revision:
            result = AgencyStateStore._normalize_content_run_media_revision_aliases(result)
        return result
