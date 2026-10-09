import os
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(__file__))
import control_plane_service as service
from automation_worker import PermanentJobError
from automation_worker_service import validate_worker_payload


def video_payload(**overrides):
    payload = {
        "workspace_id": "workspace-1",
        "page_id": "100000000000001",
        "message": "Approved video caption",
        "media_url": "https://drive.google.com/uc?export=download&id=video-1",
        "media_contract_version": 1,
        "brand_id": "brand-bellamy",
        "binding_id": "binding-bellamy-video",
        "identity_version_id": "identity-bellamy-v1",
        "target_page_id": "100000000000001",
        "media_asset_id": "drive-video-1",
        "media_status": "eligible",
        "media_source": "drive",
        "media_sha256": "a" * 64,
        "media_fingerprint": "0123456789abcdef",
        "media_fingerprint_source": "decoded_video_frames",
        "reservation_id": "reservation-video-1",
        "reservation_state": "reserved",
        "idempotency_key": "job-video-1",
        "approval_state": "approved",
        "platform": "facebook",
        "kind": "video",
        "simulation": False,
    }
    payload.update(overrides)
    return payload


class WorkerVideoPayloadTests(unittest.TestCase):
    def test_accepts_verified_approved_video_payload(self):
        validate_worker_payload(video_payload())

    def test_rejects_video_without_https_media_url(self):
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(video_payload(media_url="file:///private/video.mp4"))
        self.assertEqual(str(context.exception), "WORKER_PAYLOAD_MEDIA_URL_REQUIRED")

    def test_keeps_decoded_video_frame_fingerprint_gate(self):
        with self.assertRaises(PermanentJobError) as context:
            validate_worker_payload(video_payload(media_fingerprint_source="decoded_image"))
        self.assertEqual(str(context.exception), "WORKER_VIDEO_FINGERPRINT_REQUIRES_DECODED_FRAMES")


class ControlPlaneVideoTests(unittest.TestCase):
    class Reader:
        def __init__(self):
            self.markers = {}

        def _read_secret(self, account):
            return self.markers.get(account)

        def page_token(self, workspace_id, page_id):
            return "page-token-test-only"

        def write_scalar(self, account, value):
            self.markers[account] = value

    class Response:
        def __init__(self, status_code=200, body=None):
            self.status_code = status_code
            self._body = body or {"id": "fb-video-1"}

        def json(self):
            return self._body

    class Client:
        def __init__(self, response=None):
            self.calls = []
            self.response = response or ControlPlaneVideoTests.Response()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            return self.response

    def request(self, payload, client):
        headers = {"Authorization": "Bearer worker-test-token"}
        with patch.dict(os.environ, {"SIGNALFLOW_WORKER_AUTH_TOKEN": "worker-test-token"}, clear=False), patch.object(service, "NativeMetaPageTokenReader", return_value=self.reader), patch.object(service.httpx, "AsyncClient", return_value=client):
            return TestClient(service.app).post("/v1/worker/meta/page-video", json=payload, headers=headers)

    def setUp(self):
        self.reader = self.Reader()

    def test_publishes_page_video_with_official_file_url_contract(self):
        client = self.Client()
        response = self.request(video_payload(), client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"provider": "meta", "providerJobId": "fb-video-1", "providerState": "published", "idempotentReplay": False})
        self.assertEqual(client.calls[0][0][0], "https://graph.facebook.com/v23.0/100000000000001/videos")
        self.assertEqual(client.calls[0][1]["data"]["file_url"], video_payload()["media_url"])
        self.assertEqual(client.calls[0][1]["data"]["description"], video_payload()["message"])
        self.assertEqual(client.calls[0][1]["data"]["published"], "true")
        self.assertNotIn("page-token-test-only", response.text)

    def test_replays_page_video_idempotently_without_second_graph_call(self):
        client = self.Client()
        first = self.request(video_payload(idempotency_key="job-video-replay"), client)
        second = self.request(video_payload(idempotency_key="job-video-replay"), client)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(second.json()["idempotentReplay"])
        self.assertEqual(len(client.calls), 1)

    def test_rejects_video_without_public_url_at_control_plane(self):
        response = self.request(video_payload(media_url=None), self.Client())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "META_MEDIA_URL_INVALID")

    def test_maps_provider_error_without_echoing_provider_body(self):
        client = self.Client(self.Response(400, {"error": {"code": 100, "message": "provider-secret-body"}}))
        response = self.request(video_payload(idempotency_key="job-video-error"), client)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "META_WORKER_PROVIDER_REJECTED")
        self.assertNotIn("provider-secret-body", response.text)


if __name__ == "__main__":
    unittest.main()
