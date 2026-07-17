export interface FakeProviderRequest {
  readonly idempotencyKey: string;
  readonly operation: "generate_image" | "generate_speech" | "generate_video";
  readonly promptHash: string;
}

export interface FakeProviderResponse {
  readonly providerRequestId: string;
  readonly resultUrl: string;
  readonly status: "succeeded";
}

export class FakeProvider {
  readonly calls: FakeProviderRequest[] = [];
  readonly #responses = new Map<string, FakeProviderResponse>();

  constructor(private readonly baseUrl = "https://provider-fixture.invalid/result") {}

  async execute(request: FakeProviderRequest): Promise<FakeProviderResponse> {
    const prior = this.#responses.get(request.idempotencyKey);
    if (prior) return prior;

    this.calls.push(Object.freeze({ ...request }));
    const response = Object.freeze({
      providerRequestId: `fake_${request.idempotencyKey}`,
      resultUrl: `${this.baseUrl}/${encodeURIComponent(request.idempotencyKey)}`,
      status: "succeeded" as const,
    });
    this.#responses.set(request.idempotencyKey, response);
    return response;
  }
}
