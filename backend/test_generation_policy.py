import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

try:
    from generation_policy import GenerationPolicyError, resolve_generation_route
except ImportError:
    GenerationPolicyError = Exception
    resolve_generation_route = None


class GenerationPolicyTests(unittest.TestCase):
    def test_subscription_is_app_open_only_and_never_uses_api_fallback(self):
        self.assertIsNotNone(resolve_generation_route)
        if resolve_generation_route is None:
            return
        profile = {"id": "profile-sub", "mode": "subscription_package", "provider": "gemini_web", "model": "gemini", "capabilities": ["copy"], "status": "connected"}
        with self.assertRaisesRegex(GenerationPolicyError, "APP_OPEN_REQUIRED"):
            resolve_generation_route(profile, ["copy"], app_open=False)
        self.assertEqual(resolve_generation_route(profile, ["copy"], app_open=True)["route"], "managed_browser")

    def test_llm_route_requires_one_ready_provider_and_rejects_raw_secret_or_auth_path(self):
        self.assertIsNotNone(resolve_generation_route)
        if resolve_generation_route is None:
            return
        profile = {"id": "profile-api", "mode": "llm_provider", "provider": "openrouter", "model": "anthropic/claude", "capabilities": ["copy"], "status": "connected", "secretRef": "keychain:openrouter"}
        self.assertEqual(resolve_generation_route(profile, ["copy"], app_open=False)["route"], "provider_api")
        with self.assertRaisesRegex(GenerationPolicyError, "SENSITIVE_FIELD_REJECTED"):
            resolve_generation_route({**profile, "apiKey": "nope"}, ["copy"], app_open=False)
        with self.assertRaisesRegex(GenerationPolicyError, "AUTH_FILE_PATH_REJECTED"):
            resolve_generation_route({**profile, "authFile": "/Users/a/.hermes/auth.json"}, ["copy"], app_open=False)

    def test_route_is_explicitly_blocked_for_capability_or_disconnected_provider(self):
        self.assertIsNotNone(resolve_generation_route)
        if resolve_generation_route is None:
            return
        profile = {"id": "profile-api", "mode": "llm_provider", "provider": "openrouter", "model": "model", "capabilities": ["copy"], "status": "not_configured"}
        with self.assertRaisesRegex(GenerationPolicyError, "LLM_PROVIDER_NOT_READY"):
            resolve_generation_route(profile, ["copy"], app_open=False)
        with self.assertRaisesRegex(GenerationPolicyError, "GENERATION_CAPABILITY_MISSING"):
            resolve_generation_route({**profile, "status": "connected"}, ["video"], app_open=False)


if __name__ == "__main__":
    unittest.main()
