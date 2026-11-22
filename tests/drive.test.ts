import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveAuthError, DriveError, GoogleDrive } from '../src/sync/drive';

type Call = { url: string; init: RequestInit };
function stubFetch(answer: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init };
    calls.push(c);
    return answer(c);
  }));
  return calls;
}
const json = (v: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(v), { status: 200, ...init });
const file = { id: 'f1', name: 'n.a.meta.json', modifiedTime: '1' };

describe('the Google Drive client', () => {
  afterEach(() => vi.unstubAllGlobals());
  const drive = new GoogleDrive(() => 'tok');

  it('lists every page of the app data folder, with the token', async () => {
    const calls = stubFetch(({ url }) => (url.includes('pageToken=p2') ? json({ files: [{ ...file, id: 'f2' }] }) : json({ files: [file], nextPageToken: 'p2' })));
    expect((await drive.list()).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('uploads small files as one multipart request into the app data folder', async () => {
    const calls = stubFetch(() => json(file));
    await drive.create('n.a.meta.json', new Blob(['{"x":1}'], { type: 'application/json' }));
    const { url, init } = calls[0];
    expect(url).toContain('uploadType=multipart');
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const body = await (init.body as Blob).text();
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('{"x":1}');
  });

  it('uploads large files in a resumable session, even when Location is hidden from the page', async () => {
    const big = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'application/pdf' });
    const calls = stubFetch(({ init }) => (init.method === 'PUT' ? json(file) : new Response(null, { status: 200, headers: { 'X-GUploader-UploadID': 'abc 123' } })));
    await drive.create('n.a.blob.pdf', big);
    expect(calls[0].url).toContain('uploadType=resumable');
    expect((calls[0].init.headers as Record<string, string>)['X-Upload-Content-Type']).toBe('application/pdf');
    expect(calls[1].init.method).toBe('PUT');
    expect(calls[1].url).toMatch(/uploadType=resumable.*&upload_id=abc%20123$/);
  });

  it('uses Location when it can read it', async () => {
    const big = new Blob([new Uint8Array(5 * 1024 * 1024)]);
    const calls = stubFetch(({ init }) => (init.method === 'PUT' ? json(file) : new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } })));
    await drive.update('f1', big);
    expect(calls[1].url).toBe('https://upload.example/session');
  });

  it('expired access asks to reconnect; other failures are worth retrying; deleting a gone file is fine', async () => {
    stubFetch(() => new Response(null, { status: 401 }));
    await expect(drive.list()).rejects.toBeInstanceOf(DriveAuthError);
    stubFetch(() => new Response(null, { status: 503 }));
    await expect(drive.read('f1')).rejects.toBeInstanceOf(DriveError);
    stubFetch(() => new Response(null, { status: 404 }));
    await expect(drive.remove('f1')).resolves.toBeUndefined();
    await expect(new GoogleDrive(() => null).list()).rejects.toBeInstanceOf(DriveAuthError);
  });
});
