const TOKEN_STORAGE_KEY = 'moda_session_token';
let memorySessionToken: string | null = null;

export function setClientSessionToken(token: string | null | undefined): void {
  memorySessionToken = token || null;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors in strict iframe sandboxes
  }
}

export function getClientSessionToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || memorySessionToken;
  } catch {
    return memorySessionToken;
  }
}

export function clearClientSessionToken(): void {
  setClientSessionToken(null);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getClientSessionToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    clearClientSessionToken();
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Permintaan gagal (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export async function downloadAuthedCsv(url: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getClientSessionToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError('Gagal mengekspor data CSV.', res.status);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

export function formatWib(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d) + ' WIB'
  );
}

export function formatWibDateOnly(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
