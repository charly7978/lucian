/** Campaña comercial: precios exclusivos, sin mutar el catálogo. */
export function campaignPriceMap(selectedProducts, requested = {}) {
  if (requested === null || typeof requested !== 'object' || Array.isArray(requested)) {
    const error = new Error('La lista de precios de campaña tiene un formato inválido.');
    error.status = 400;
    throw error;
  }
  const selected = new Map(selectedProducts.map(item => [item.id, item]));
  const result = new Map();
  for (const [id, raw] of Object.entries(requested)) {
    if (!selected.has(id)) {
      const error = new Error('Se intentó modificar el precio de una lámpara no seleccionada. Actualizá la vista previa.');
      error.status = 400;
      throw error;
    }
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      const error = new Error('El precio de campaña debe ser un número.');
      error.status = 400;
      throw error;
    }
    if (typeof raw === 'string' && !/^\s*\d+(?:\.\d{1,2})?\s*$/.test(raw)) {
      const error = new Error(`Precio no válido para ${selected.get(id).name}. Usá punto decimal y hasta dos decimales.`);
      error.status = 400;
      throw error;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
      const error = new Error(`El precio de campaña para ${selected.get(id).name} debe ser positivo y tener hasta dos decimales.`);
      error.status = 400;
      throw error;
    }
    result.set(id, Math.round(value * 100) / 100);
  }
  return result;
}

export function campaignProductView(product, overrides) {
  const overridden = overrides.has(product.id);
  const price = overridden ? overrides.get(product.id) : Number(product.price) || 0;
  return { ...product, price, campaignPriceOverridden: overridden };
}
