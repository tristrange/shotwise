import { execFileSync } from 'node:child_process';
import { z } from 'zod';

export function localStack() {
  const result = execFileSync(
    'npx',
    ['supabase', 'status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const status = z
    .object({
      API_URL: z.string(),
      PUBLISHABLE_KEY: z.string(),
      SERVICE_ROLE_KEY: z.string(),
      DB_URL: z.string(),
    })
    .parse(JSON.parse(result));
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL) ||
    !status.DB_URL.includes('127.0.0.1:')
  )
    throw new Error('Acceptance tests only run against local Supabase.');
  return status;
}
