export const DEFAULT_CATALOG_FILTERS = Object.freeze({
  query: '', category: '', status: '', availability: '', currency: '',
  minPrice: '', maxPrice: '', details: '', sort: '', selectedOnly: false,
});

const spanish = new Intl.Collator('es-AR', { numeric: true, sensitivity: 'base' });
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const categoryName = product => String(product.category || '').trim() || 'Sin categoría';
const currencyCode = product => String(product.currency || 'USD').trim().toUpperCase() || 'USD';
const priceOf = product => Number.isFinite(Number(product.price)) && Number(product.price) > 0 ? Number(product.price) : null;

export function catalogFilterOptions(products) {
  const categories = new Map();
  const currencies = new Set();
  for (const product of products) {
    const label = categoryName(product);
    if (!categories.has(normalize(label))) categories.set(normalize(label), label);
    currencies.add(currencyCode(product));
  }
  return {
    categories: [...categories].sort((a, b) => spanish.compare(a[1], b[1])),
    currencies: [...currencies].sort(),
  };
}

export function filterCatalog(products, filters = DEFAULT_CATALOG_FILTERS, selectedProducts = []) {
  const terms = normalize(filters.query).split(/\s+/).filter(Boolean);
  const selected = new Set(selectedProducts);
  const currencies = new Set(products.map(currencyCode));
  const number = value => String(value ?? '').trim() ? Number(value) : null;
  const min = number(filters.minPrice);
  const max = number(filters.maxPrice);
  const hasRange = min !== null || max !== null;
  let priceError = '';
  if (hasRange) {
    if ([min, max].some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
      priceError = 'Ingresá precios positivos o cero.';
    } else if (min !== null && max !== null && min > max) {
      priceError = 'El precio desde debe ser menor o igual al precio hasta.';
    } else if (currencies.size > 1 && !filters.currency) {
      priceError = 'Elegí una moneda para aplicar el rango de precios.';
    }
  }

  const visible = products.filter(product => {
    if (filters.selectedOnly && !selected.has(product.id)) return false;
    if (filters.status && filters.status !== (product.status || 'borrador')) return false;
    if (filters.category && filters.category !== normalize(categoryName(product))) return false;
    if (filters.currency && filters.currency !== currencyCode(product)) return false;

    const availability = !product.storefront ? 'unlinked' : product.storefront.available === true ? 'available' : 'unavailable';
    if (filters.availability && filters.availability !== availability) return false;

    const price = priceOf(product);
    const photo = Array.isArray(product.photos) && product.photos.some(photo => Boolean(photo?.file));
    if (filters.details === 'ready' && (!photo || price === null)) return false;
    if (filters.details === 'missing' && photo && price !== null) return false;
    if (filters.details === 'no-photo' && photo) return false;
    if (filters.details === 'no-price' && price !== null) return false;
    if (hasRange && !priceError && (price === null || (min !== null && price < min) || (max !== null && price > max))) return false;

    if (!terms.length) return true;
    const content = normalize([product.name, product.code, product.category, product.materials, product.description, product.notes].join(' '));
    return terms.every(term => content.includes(term));
  });

  const byName = (a, b) => spanish.compare(a.name || '', b.name || '');
  if (filters.sort === 'name') visible.sort(byName);
  if (filters.sort === 'price-low' || filters.sort === 'price-high') {
    const direction = filters.sort === 'price-low' ? 1 : -1;
    visible.sort((a, b) => {
      const priceA = priceOf(a);
      const priceB = priceOf(b);
      return spanish.compare(currencyCode(a), currencyCode(b))
        || Number(priceA === null) - Number(priceB === null)
        || direction * (priceA - priceB) || byName(a, b);
    });
  }
  return { visible, priceError };
}
