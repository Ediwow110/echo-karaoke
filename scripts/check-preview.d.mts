export type PreviewFetch = (input: string, init?: { redirect?: 'manual' }) => Promise<Response>;

export type PreviewCheckOptions = {
  fetchImpl?: PreviewFetch;
  supabaseUrl?: string | null;
};

export function expectedSupabaseOrigin(env?: Record<string, string | undefined>): string | null;
export function checkPreview(input: string, options?: PreviewCheckOptions): Promise<{ errors: string[] }>;
export function main(env?: Record<string, string | undefined>): Promise<void>;
