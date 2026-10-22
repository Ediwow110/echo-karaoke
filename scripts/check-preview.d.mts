export type PreviewFetch = (
  input: string,
  init?: {
    redirect?: 'manual';
    headers?: Record<string, string>;
    method?: string;
    body?: string;
  },
) => Promise<Response>;

export type PreviewCheckOptions = {
  fetchImpl?: PreviewFetch;
  bypassToken?: string | null;
};

export function checkPreview(input: string, options?: PreviewCheckOptions): Promise<{ errors: string[] }>;
export function main(env?: Record<string, string | undefined>): Promise<void>;
