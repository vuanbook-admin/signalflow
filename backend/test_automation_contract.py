import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from automation_worker import PermanentJobError
from automation_worker_service import validate_worker_payload


class AutomationContractValidationTests(unittest.TestCase):
    def base_payload(self):
        return {
            "media_contract_version": 1,
            "workspace_id": "workspace-1",
            "brand_id": "brand-1",
            "binding_id": "binding-1",
            "identity_version_id": "identity-1-v1",
            "page_id": "page-1",
            "target_page_id": "page-1",
            "message": "Approved",
            "media_url": "https://cdn.example.test/hero.jpg",
            "media_asset_id": "asset-1",
            "media_status": "eligible",
            "media_source": "public_https",
            "media_sha256": "a" * 64,
            "media_fingerprint": "0000000000000000",
            "media_fingerprint_source": "decoded_image",
            "reservation_id": "reservation-1",
            "reservation_state": "reserved",
            "idempotency_key": "workspace-1:page-1:2026-08-23:0",
            "approval_state": "approved",
            "platform": "facebook",
            "kind": "image",
            "simulation": False,
        }

    def test_accepts_a_valid_approved_page_payload_with_reserved_eligible_media(self):
        validate_worker_payload(self.base_payload())

    def test_accepts_missing_legacy_simulation_marker_but_rejects_true_simulation(self):
        payload = self.base_payload()
        payload.pop("simulation")
        validate_worker_payload(payload)
        payload["simulation"] = True
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_SIMULATION_NOT_ALLOWED")

    def test_rejects_missing_fingerprint(self):
        payload = self.base_payload()
        payload.pop("media_fingerprint")
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_MEDIA_FINGERPRINT_REQUIRED")

    def test_rejects_missing_or_invalid_fingerprint_provenance(self):
        payload = self.base_payload()
        payload.pop("media_fingerprint_source")
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_MEDIA_FINGERPRINT_SOURCE_REQUIRED")

        payload = self.base_payload()
        payload["media_fingerprint_source"] = "decoded_video_frames"
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_IMAGE_FINGERPRINT_SOURCE_INVALID")

    def test_rejects_private_failed_duplicate_or_used_media(self):
        for field, value, code in [
            ("media_status", "private", "WORKER_MEDIA_NOT_ELIGIBLE"),
            ("media_status", "duplicate", "WORKER_MEDIA_NOT_ELIGIBLE"),
            ("reservation_state", "used", "WORKER_RESERVATION_NOT_RESERVED"),
        ]:
            payload = self.base_payload()
            payload[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(PermanentJobError) as context:
                    validate_worker_payload(payload)
                self.assertEqual(str(context.exception), code)

    def test_rejects_wrong_target_page_and_missing_reservation(self):
        payload = self.base_payload()
        payload["target_page_id"] = "page-other"
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_PAGE_MISMATCH")

        payload = self.base_payload()
        payload.pop("reservation_id")
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_RESERVATION_REQUIRED")

    def test_rejects_missing_binding_or_identity_version_before_provider_execution(self):
        for field, code in [("binding_id", "WORKER_BINDING_ID_REQUIRED"), ("identity_version_id", "WORKER_IDENTITY_VERSION_ID_REQUIRED")]:
            payload = self.base_payload()
            payload.pop(field)
            with self.subTest(field=field):
                with self.assertRaises(PermanentJobError) as context:
                    validate_worker_payload(payload)
                self.assertEqual(str(context.exception), code)

    def test_rejects_hermes_or_opencode_auth_file_paths(self):
        payload = self.base_payload()
        payload["agency_contract_version"] = 1
        payload["provider_path"] = "/Users/test/.local/share/opencode/auth.json"
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(payload)
        self.assertEqual(str(context.exception), "WORKER_AUTH_FILE_PATH_REJECTED")


if __name__ == "__main__":
    unittest.main()
