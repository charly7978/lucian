import { normalizeDomain } from './util.mjs';

const API = 'https://api.tiendanube.com/v1';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const DAY = 86400000;

async function requestGalapa({ storeId, token }, endpoint, fetcher) {
  if (!/^\d{1,18}$/.test(String(storeId || '')) || typeof token !== 'string' || !token.trim()) {
    throw new Error('Completá el ID de tienda y un token de Tiendanube con permiso para leer pedidos.');
  }
  const response = await fetcher(`${API}/${storeId}/${endpoint}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: {
      Authentication: `bearer ${token.trim()}`,
      'User-Agent': 'Lucian Xalapa (https://galapa.com.ar)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Tiendanube respondió HTTP ${response.status}. Revisá el acceso de lectura a pedidos.`);
  return response.json();
}

export async function verifyGalapaStore(config, fetcher = fetch) {
  const data = await requestGalapa(config, 'store', fetcher);
  const domains = [data.main_domain, data.url, ...(Array.isArray(data.domains) ? data.domains : [])]
    .map((value) => normalizeDomain(typeof value === 'object' ? value?.domain || value?.url : value));
  if (String(data.id) !== String(config.storeId) || !domains.includes('galapa.com.ar')) {
    throw new Error('La tienda conectada debe tener el dominio galapa.com.ar.');
  }
}

function key(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function syncGalapaOrders({ config, products, previous = [], checkedAt, now = Date.now(), fetcher = fetch }) {
  await verifyGalapaStore(config, fetcher);
  const start = Number.isFinite(Date.parse(checkedAt)) ? Math.max(Date.parse(checkedAt) - 120000, now - 30 * DAY) : now - 30 * DAY;
  const orders = new Map(previous.map((order) => [order.id, order]));
  const catalog = products.filter((p) => !p.demo && p.storefront?.url);
  const names = new Set(catalog.map((p) => key(p.name)).filter(Boolean));
  const codes = new Set(catalog.map((p) => key(p.code)).filter(Boolean));
  const keepFrom = now - 30 * DAY;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      updated_at_min: new Date(start).toISOString(), per_page: String(PAGE_SIZE), page: String(page),
      fields: 'id,number,store_id,status,payment_status,created_at,paid_at,updated_at,products',
    });
    const data = await requestGalapa(config, `orders?${params}`, fetcher);
    if (!Array.isArray(data)) throw new Error('Tiendanube no devolvió una lista de pedidos.');
    for (const order of data) {
      const id = String(order.id || '');
      if (!id || (order.store_id && String(order.store_id) !== String(config.storeId))) continue;
      const createdAt = Date.parse(order.created_at);
      if (!Number.isFinite(createdAt) || createdAt < keepFrom) continue;
      const matches = (Array.isArray(order.products) ? order.products : []).some((line) => codes.has(key(line.sku)) || names.has(key(line.name)));
      if (!matches && !orders.has(id)) continue;
      const payment = order.status === 'cancelled' ? 'cancelled' : String(order.payment_status || 'unknown');
      orders.set(id, { id, number: String(order.number || ''), payment, createdAt: order.created_at, paidAt: order.paid_at || null });
    }
    if (data.length < PAGE_SIZE) {
      return {
        at: new Date(now).toISOString(),
        orders: [...orders.values()].filter((order) => Date.parse(order.createdAt) >= keepFrom),
      };
    }
  }
  throw new Error('La tienda devolvió más pedidos de los que se pueden sincronizar en una sola consulta.');
}
