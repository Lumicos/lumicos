export const KNOWLEDGE_ROUTES = Object.freeze(['DIRECT', 'LOCAL', 'WEB', 'HYBRID', 'MEMORY']);

export function normalizeRoute(value) {
  const route = String(value ?? '').trim().toUpperCase();
  if (!KNOWLEDGE_ROUTES.includes(route)) throw new TypeError(`Unknown knowledge route: ${value}`);
  return route;
}

