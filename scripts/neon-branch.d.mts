export type BranchOptions = {
  apiKey: string;
  projectId: string;
  name: string;
  ownerUrl: string;
  serviceUrl: string;
  authUrl: string;
  fetchImpl?: typeof fetch;
};

export type BranchUrls = {
  branchId: string;
  neonDatabaseUrl: string;
  serviceDatabaseUrl: string;
  authDatabaseUrl: string;
};

export function createBranch(options: BranchOptions): Promise<BranchUrls>;
export function deleteBranch(options: {
  apiKey: string;
  projectId: string;
  branchId: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean>;
export function mask(value: string): void;
export function main(args?: string[], env?: Record<string, string | undefined>): Promise<void>;
