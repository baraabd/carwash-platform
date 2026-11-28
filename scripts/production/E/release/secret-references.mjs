// These are evidence locators, never URLs to fetch or secret values to resolve.
// Keep existing store contracts; Railway has an explicit, narrower grammar.
const EXISTING_STORE = /^(vault|aws-sm|gcp-sm|azure-kv|k8s-secret):\/\/\S+$/;
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VARIABLE_NAME = /^[A-Z_][A-Z0-9_]{0,254}$/;
const FILE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** Parse the exact spelling: URL normalization must not hide traversal or encodings. */
export function parseRailwaySecretReference(reference) {
  if (typeof reference !== 'string' || reference.length > 2048 || /[?#@%\\\s]/.test(reference))
    return null;
  const scope = /^railway:\/\/project\/([^/]+)\/environment\/([^/]+)\/service\/([^/]+)\/(.+)$/.exec(
    reference,
  );
  if (!scope || !scope.slice(1, 4).every((id) => RESOURCE_ID.test(id))) return null;
  const [, projectId, environmentId, serviceId, resource] = scope;
  const identity = { projectId, environmentId, serviceId };
  if (resource.startsWith('variable/')) {
    const variableName = resource.slice('variable/'.length);
    return VARIABLE_NAME.test(variableName)
      ? { ...identity, kind: 'variable', variableName }
      : null;
  }
  const file = /^volume\/([^/]+)\/file\/(.+)$/.exec(resource);
  if (!file || !RESOURCE_ID.test(file[1])) return null;
  const [, volumeId, filePath] = file;
  if (filePath.length > 1024 || !filePath.split('/').every((part) => FILE_SEGMENT.test(part)))
    return null;
  return { ...identity, kind: 'volume-file', volumeId, filePath };
}

export function isSecretReference(reference) {
  return (
    typeof reference === 'string' &&
    (EXISTING_STORE.test(reference) || parseRailwaySecretReference(reference) !== null)
  );
}
