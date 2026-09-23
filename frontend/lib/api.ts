export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function requestJSON(path: string, options: RequestInit = {}) {
  const timeout = AbortSignal.timeout(path === 'courses/grade' ? 70000 : path === 'recommendations' ? 60000 : 15000);
  let headers = options.headers;
  if (typeof document !== 'undefined') {
    const localizedHeaders = new Headers(headers);
    localizedHeaders.set('Accept-Language', document.documentElement.lang === 'kk' ? 'kk-KZ' : 'ru-KZ');
    headers = localizedHeaders;
  }
  try {
    const response = await fetch(`/api/${path}`, {
      ...options,
      headers,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    const json = await response.json().catch(error => {
      if (timeout.aborted || options.signal?.aborted) throw error;
      return null;
    });
    if (!response.ok) throw new ApiError(json?.error || 'Сервис временно недоступен. Попробуйте ещё раз.', response.status);
    if (json === null) throw new ApiError('Не удалось прочитать ответ сервера. Попробуйте ещё раз.');
    return json;
  } catch (error) {
    if (options.signal?.aborted || error instanceof ApiError) throw error;
    if (timeout.aborted) throw new ApiError(options.method === 'POST'
      ? 'Не получили ответ вовремя. Обновите данные и проверьте результат перед повторной отправкой.'
      : 'Сервер отвечает дольше обычного. Проверьте соединение и попробуйте ещё раз.');
    throw new ApiError('Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.');
  }
}
