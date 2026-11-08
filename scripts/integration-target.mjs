// The integration suite creates rooms, queue rows and catalog cursors wherever
// it points. A credential set alone does not prove the target is disposable:
// .env.local points at production Neon. Make the operator name the target.
const REQUIRED = ['DATABASE_URL', 'AUTH_DATABASE_URL', 'BETTER_AUTH_SECRET'];
const CONFIRMATION = 'INTEGRATION_TARGET_CONFIRMED';
const GUIDANCE = 'Set ' + CONFIRMATION + '=1 only after verifying DATABASE_URL and '
  + 'AUTH_DATABASE_URL point at a disposable Neon branch.';

export function checkIntegrationTarget(env = process.env) {
  const errors = [];
  const hasAll = REQUIRED.every((name) => String(env[name] ?? '').trim().length > 0);
  if (!hasAll) {
    // The suite skips itself when credentials are incomplete.
    return errors;
  }
  if (String(env[CONFIRMATION] ?? '').trim() !== '1') {
    errors.push(GUIDANCE);
  }
  return errors;
}

export function assertIntegrationTarget(env = process.env) {
  const errors = checkIntegrationTarget(env);
  if (errors.length > 0) {
    throw new Error('Integration target is not safe:\n- ' + errors.join('\n- '));
  }
}
