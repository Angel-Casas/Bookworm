export type EmbedResult = {
  readonly vectors: readonly Float32Array[];
  readonly usage?: { readonly prompt: number };
};

export type EmbedClient = {
  embed(req: {
    readonly modelId: string;
    readonly inputs: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<EmbedResult>;
};
