const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('./security.cjs');
const { assertProfileRequestCurrent, LOCAL_MEDIA_IMPORT_MAX_BYTES, validateCommandArgs } = security;

test('validates the local media import command shape and decoded-byte ceiling', () => {
  const args = {
    clientId: 'client-a',
    brandId: 'brand-a',
    fileName: 'reference.png',
    declaredMimeType: 'image/png',
    fileBytesBase64: Buffer.from('bytes').toString('base64'),
  };
  assert.equal(validateCommandArgs('import_local_media', args), args);
  assert.throws(() => validateCommandArgs('import_local_media', { ...args, clientId: '../outside' }), /ELECTRON_ARG_INVALID:clientId/);
  assert.throws(() => validateCommandArgs('import_local_media', { ...args, extra: 'path' }), /ELECTRON_ARGS_INVALID/);
  const tooLarge = { ...args, fileBytesBase64: 'A'.repeat(Math.ceil(LOCAL_MEDIA_IMPORT_MAX_BYTES / 3) * 4 + 4) };
  assert.throws(() => validateCommandArgs('import_local_media', tooLarge), /LOCAL_MEDIA_IMPORT_TOO_LARGE/);
});

test('allows workspace-scoped worker reads and rejects arbitrary query forwarding', () => {
  for (const route of ['/health', '/v1/jobs']) {
    const args = { path: `${route}?workspace_id=workspace-profile-linh`, method: 'GET', body: '' };
    assert.deepEqual(validateCommandArgs('worker_request', args), args);
  }
  assert.throws(() => validateCommandArgs('worker_request', { path: '/v1/jobs', method: 'POST', body: '{"job_id":"job_1"}' }));
  assert.throws(() => validateCommandArgs('worker_request', { path: '/v1/jobs/job_1/action', method: 'POST', body: '{"action":"cancel","expected_revision":0}' }));
  assert.deepEqual(validateCommandArgs('gemini_web_complete', { workspaceId: 'workspace-a', prompt: 'prompt', model: 'model', attachmentPaths: ['/tmp/image.png'], attachmentHashes: ['a'.repeat(64)] }).attachmentHashes, ['a'.repeat(64)]);
  for (const pathname of ['/health?workspace_id=', '/health?workspace_id=a&workspace_id=b', '/health?other=a', '/v1/stop?workspace_id=a', '/health?workspace_id=../a', '//example.com/health']) {
    assert.throws(() => validateCommandArgs('worker_request', { path: pathname, method: 'GET', body: '' }));
  }
});

test('validates profile activation IDs', () => {
  assert.deepEqual(validateCommandArgs('profile_selection', {}), {});
  assert.deepEqual(validateCommandArgs('profile_activate', { profileId: 'profile-linh' }), { profileId: 'profile-linh' });
  assert.throws(() => validateCommandArgs('profile_activate', { profileId: '../other-profile' }));
  assert.throws(() => validateCommandArgs('profile_activate', { profileId: 'profile-Linh' }));
});

test('rejects late profile results after A to B to A even when the profile ID matches again', () => {
  assert.equal(assertProfileRequestCurrent('profile-a', 7, 'profile-a', 7), true);
  assert.throws(() => assertProfileRequestCurrent('profile-a', 7, 'profile-b', 8), { message: 'PROFILE_RESULT_STALE' });
  assert.throws(() => assertProfileRequestCurrent('profile-a', 7, 'profile-a', 9), { message: 'PROFILE_RESULT_STALE' });
});

test('requires a profile and revision on Meta OAuth code exchange requests', () => {
  const base = { workspaceId: 'workspace-1', appId: '123456', code: 'oauth-code', redirectUri: 'https://localhost/oauth/callback' };
  assert.throws(() => validateCommandArgs('meta_exchange_oauth_code', base), /ELECTRON_ARG_INVALID:profileId/);
  assert.throws(() => validateCommandArgs('meta_exchange_oauth_code', { ...base, profileId: 'profile-a' }), /ELECTRON_ARG_INVALID:profileRevision/);
  const args = { ...base, profileId: 'profile-a', profileRevision: 7 };
  assert.deepEqual(validateCommandArgs('meta_exchange_oauth_code', args), args);
});

test('rejects profile A OAuth code after native A to B activation before exchange starts', () => {
  const lateRendererArgs = validateCommandArgs('meta_exchange_oauth_code', {
    workspaceId: 'workspace-shared',
    appId: '123456',
    code: 'oauth-code-a',
    redirectUri: 'https://localhost/oauth/callback',
    profileId: 'profile-a',
    profileRevision: 11,
  });
  let exchangeCalls = 0;

  assert.throws(() => {
    assertProfileRequestCurrent(lateRendererArgs.profileId, lateRendererArgs.profileRevision, 'profile-b', 12);
    exchangeCalls += 1;
  }, { message: 'PROFILE_RESULT_STALE' });
  assert.equal(exchangeCalls, 0);
});

test('removes native Safe Mode and the safeMode field from live publish validation', () => {
  assert.throws(() => validateCommandArgs('meta_set_safety_mode', { profileId: 'profile-a', profileRevision: 7, workspaceId: 'workspace-a', requestId: 1, safeMode: false }), /ELECTRON_COMMAND_NOT_IMPLEMENTED/);

  const publishRequests = {
    meta_publish_page_job: { workspaceId: 'workspace-a', pageId: '123', idempotencyKey: 'key-a', approvalState: 'approved', message: 'hello' },
    meta_publish_page_photo_job: { workspaceId: 'workspace-a', pageId: '123', idempotencyKey: 'key-a', approvalState: 'approved', caption: 'hello', mediaUrl: 'https://example.com/image.jpg' },
    meta_publish_page_video_job: { workspaceId: 'workspace-a', pageId: '123', idempotencyKey: 'key-a', approvalState: 'approved', caption: 'hello', mediaUrl: 'https://example.com/video.mp4' },
    meta_publish_instagram_job: { workspaceId: 'workspace-a', pageId: '123', instagramUserId: '456', idempotencyKey: 'key-a', approvalState: 'approved', caption: 'hello', mediaUrl: 'https://example.com/image.jpg', mediaKind: 'image' },
  };

  for (const [command, request] of Object.entries(publishRequests)) {
    assert.deepEqual(validateCommandArgs(command, request), request);
    assert.throws(() => validateCommandArgs(command, { ...request, safeMode: false }), /ELECTRON_ARGS_INVALID/);
  }
});
