// The Google Drive app data folder over its REST API, straight from the browser. The folder is
// hidden from the person's Drive and only this app can see it (scope drive.appdata).

export interface DriveFile {
  id: string;
  name: string;
  /** Changes whenever the file's content does; used to skip downloading what is already cached. */
  modifiedTime: string;
  mimeType?: string;
}

/** What the sync engine needs from storage, so tests can use a fake. */
export interface Drive {
  list(): Promise<DriveFile[]>;
  read(id: string): Promise<ArrayBuffer>;
  create(name: string, body: Blob): Promise<DriveFile>;
  update(id: string, body: Blob): Promise<DriveFile>;
  remove(id: string): Promise<void>;
}

/** The access token has expired or been revoked: the person needs to reconnect. */
export class DriveAuthError extends Error {}

/** Drive said no for another reason (offline, rate limit, server error); worth trying again later. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,modifiedTime,mimeType';
/** Above this, upload in a resumable session (multipart uploads are limited to 5 MB). */
const MULTIPART_LIMIT = 4 * 1024 * 1024;

export class GoogleDrive implements Drive {
  constructor(private token: () => string | null) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.token();
    if (!token) throw new DriveAuthError('Not connected to Google Drive');
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new DriveAuthError('Google Drive access has expired');
    if (!res.ok) throw new DriveError(`Google Drive answered ${res.status}`, res.status);
    return res;
  }

  async list(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: `nextPageToken,files(${FIELDS})` });
      if (pageToken) q.set('pageToken', pageToken);
      const page = (await (await this.call(`${API}?${q}`)).json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  }

  async read(id: string): Promise<ArrayBuffer> {
    return (await this.call(`${API}/${encodeURIComponent(id)}?alt=media`)).arrayBuffer();
  }

  async create(name: string, body: Blob): Promise<DriveFile> {
    const metadata = { name, parents: ['appDataFolder'] };
    if (body.size > MULTIPART_LIMIT) return this.resumable(`${UPLOAD}?uploadType=resumable&fields=${FIELDS}`, 'POST', metadata, body);
    const boundary = `jnotes${Math.random().toString(36).slice(2)}`;
    const multipart = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${body.type || 'application/octet-stream'}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ]);
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    return (await res.json()) as DriveFile;
  }

  async update(id: string, body: Blob): Promise<DriveFile> {
    const url = `${UPLOAD}/${encodeURIComponent(id)}`;
    if (body.size > MULTIPART_LIMIT) return this.resumable(`${url}?uploadType=resumable&fields=${FIELDS}`, 'PATCH', {}, body);
    const res = await this.call(`${url}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      body,
    });
    return (await res.json()) as DriveFile;
  }

  /** Large files: open an upload session, then send the bytes to it in one request. */
  private async resumable(url: string, method: string, metadata: object, body: Blob): Promise<DriveFile> {
    const start = await this.call(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': body.type || 'application/octet-stream' },
      body: JSON.stringify(metadata),
    });
    // The session's address is in Location; if the browser isn't allowed to read that header,
    // it is the same address plus the upload id, which Google always lets the page read.
    const uploadId = start.headers.get('X-GUploader-UploadID');
    const session = start.headers.get('Location') ?? (uploadId ? `${url}&upload_id=${encodeURIComponent(uploadId)}` : null);
    if (!session) throw new DriveError('Google Drive did not start the upload', 0);
    const res = await this.call(session, { method: 'PUT', body });
    return (await res.json()) as DriveFile;
  }

  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      // Already gone is fine.
      if (!(e instanceof DriveError && e.status === 404)) throw e;
    }
  }
}

export const jsonBlob = (v: unknown): Blob => new Blob([JSON.stringify(v)], { type: 'application/json' });
export const readJson = async <T>(drive: Drive, id: string): Promise<T> => JSON.parse(new TextDecoder().decode(await drive.read(id))) as T;
