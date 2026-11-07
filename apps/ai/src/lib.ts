export function createApi(token: () => Promise<string>) {
  return async function request(path: string, method = 'GET', value?: unknown, signal?: AbortSignal) {
    const response = await fetch(path, {method, signal, headers: {'Authorization': 'Bearer ' + await token(), ...(value === undefined ? {} : {'Content-Type': 'application/json'})}, ...(value === undefined ? {} : {body: JSON.stringify(value)})});
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as {message?: string};
      throw Error(result.message || '请求失败，请重试');
    }
    return response;
  };
}
export type Api = ReturnType<typeof createApi>;
