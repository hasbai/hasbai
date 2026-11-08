export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function failure(error: unknown) {
  return Response.json({message: error instanceof HttpError ? error.message : 'AI 服务暂时不可用'}, {
    status: error instanceof HttpError ? error.status : 502,
    headers: {'Cache-Control': 'no-store'},
  });
}
