import { createHash } from 'node:crypto';

const PRICE_ACTIONS = new Set(['fixed-price', 'percent-price']);
const STATUS_ACTIONS = new Set(['archive', 'restore', 'delete']);
function money(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function snapshot(rows) {
  return createHash('sha256').update(JSON.stringify(rows.map(p => [p.id, p.updatedAt, p.price, p.currency, p.status]))).digest('hex');
}
function fail(message) { const error = new Error(message); error.status = 400; throw error; }

/** Pure planning step. Does not modify data. Changes are atomic when the caller saves. */
export function planCatalogBulk(products, body = {}) {
  const ids = Array.isArray(body.productIds) ? [...new Set(body.productIds.filter(id => typeof id === 'string' && id))] : [];
  if (!ids.length) fail('Seleccioná al menos una lámpara.');
  const all = Array.isArray(products) ? products : [];
  const lookup = new Map(all.map(p => [p.id, p]));
  if (ids.some(id => !lookup.has(id))) fail('Cambió el catálogo. Recargá Productos antes de continuar.');
  const chosen = ids.map(id => lookup.get(id));
  const action = String(body.action || '');
  if (!PRICE_ACTIONS.has(action) && !STATUS_ACTIONS.has(action)) fail('Acción masiva desconocida.');
  const currencies = [...new Set(chosen.map(p => p.currency || 'USD'))];
  if (action === 'fixed-price' && currencies.length > 1) fail('La selección mezcla monedas. Filtrá las lámparas por moneda o editá sus precios individualmente.');
  let value;
  if (PRICE_ACTIONS.has(action)) {
    if (body.value === '' || body.value === null || body.value === undefined) fail('Ingresá un precio o porcentaje.');
    value = Number(body.value);
    if (!Number.isFinite(value)) fail('El valor debe ser un número válido.');
    if (action === 'fixed-price' && value <= 0) fail('El precio nuevo debe ser positivo.');
    if (action === 'percent-price' && value <= -100) fail('El descuento no puede dejar un precio igual o inferior a cero.');
  }
  const changes = chosen.map(p => {
    const updated = { ...p };
    if (action === 'archive') updated.status = 'archivado';
    if (action === 'restore') updated.status = 'borrador';
    if (action === 'fixed-price') updated.price = money(value);
    if (action === 'percent-price') updated.price = money(Number(p.price || 0) * (1 + value / 100));
    if (PRICE_ACTIONS.has(action) && (!Number.isFinite(updated.price) || !(updated.price > 0) || updated.price > Number.MAX_SAFE_INTEGER / 100)) fail(`La lámpara ${p.name} no tiene un precio representable con seguridad.`);
    return {
      id: p.id, name: String(p.name || p.id), currency: p.currency || 'USD',
      oldPrice: Number(p.price) || 0, newPrice: updated.price,
      oldStatus: p.status || 'borrador', newStatus: updated.status,
      changed: action === 'delete' || updated.price !== p.price || updated.status !== p.status,
    };
  });
  return { action, count: changes.length, changed: changes.filter(c => c.changed).length,
    snapshot: snapshot(chosen), currencies, changes,
    warning: action === 'delete' ? 'Eliminar es irreversible en la interfaz. No se eliminarán fichas con misiones o conversaciones vinculadas; conservá el respaldo de datos.' : 'Previsualización sin cambios. Confirmar actualiza el catálogo, no altera las cotizaciones ya emitidas.' };
}
