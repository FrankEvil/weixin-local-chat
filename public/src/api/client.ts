export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('weixin-local-chat-auth-required'));
    }
    throw new ApiError(text || response.statusText || '请求失败', response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export async function formRequest<T>(input: string, body: FormData, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, {
    ...init,
    method: init.method ?? 'POST',
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('weixin-local-chat-auth-required'));
    }
    throw new ApiError(text || response.statusText || '请求失败', response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}
