import { galapaProductUrl } from './galapa-catalog.mjs';
import { inspectSite } from './hunter.mjs';
import { searchWebDetailed } from './search.mjs';
import { isDemoEmail, isValidEmail } from './email.mjs';
import { normalizeDomain, nowISO, truncate } from './util.mjs';

export const XALAPA_SEARCH_VERSION = 2;

export const XALAPA_SEGMENTS = {
  hoteles: {
    queries: [
      'hotel boutique Buenos Aires Palermo habitaciones reservas sitio oficial',
      'hotel boutique Buenos Aires Recoleta San Telmo hotel habitaciones contacto',
    ],
    required: /\bhotel(?:es)?\b/i,
    evidence: [
      [/\b(?:habitaciones?|suites?|alojamiento|reservas?)\b/i, 'Hotel con alojamiento publicado'],
    ],
  },
  mayoristas: {
    queries: [
      'distribuidora mayorista de iluminación Buenos Aires lámparas venta mayorista',
      'Buenos Aires iluminación de diseño luminarias para proyectos profesionales contacto',
    ],
    required: /iluminaci[oó]n|l[aá]mparas?|luminarias?/i,
    specialty: /(?:iluminaci[oó]n|l[aá]mparas?|luminarias?).{0,100}(?:mayoristas?|proyectos?|profesionales|arquitectos?)|(?:mayoristas?|proyectos?|profesionales|arquitectos?).{0,100}(?:iluminaci[oó]n|l[aá]mparas?|luminarias?)/is,
    evidence: [
      [/\bmayoristas?\b|\bdistribuci[oó]n\b|\bdistribuidores?\b|\bdistribuidoras?\b/i, 'Venta mayorista o distribución publicada'],
      [/\bproyectos?\b|\barquitectos?\b|\bprofesionales\b/i, 'Iluminación para proyectos o profesionales'],
    ],
  },
};

const excludedDomains = /(?:^|\.)(?:galapa\.com\.ar|instagram\.com|facebook\.com|linkedin\.com|youtube\.com|wikipedia\.org|mercadolibre\.com(?:\.ar)?|booking\.com|tripadvisor\.[a-z.]+|expedia\.[a-z.]+|airbnb\.[a-z.]+|kayak\.[a-z.]+|agoda\.com|despegar\.[a-z.]+|trivago\.[a-z.]+|google\.[a-z.]+|estilosdeco\.com|yably\.com\.ar|paginasamarillas\.com\.ar|cylex\.com\.ar)$/i;

export function xalapaProducts(products) {
  return products.filter((product) => !product.demo && product.status === 'listo' && product.storefront?.available
    && galapaProductUrl(product.storefront?.url) && Number(product.price) > 0);
}

function websiteOrigin(url) {
  try {
    const source = new URL(url);
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return '';
    return source.origin;
  } catch {
    return '';
  }
}

function assessWebsite(site, origin, segment, searchTitle) {
  const domain = normalizeDomain(origin);
  const pages = site.pages.filter((page) => normalizeDomain(page) === domain);
  const text = `${site.title} ${site.sample}`;
  if (!site.reachable || !pages.length || !segment.required.test(text)
    || !(/buenos aires|argentina/i.test(text) || domain.endsWith('.ar'))) return null;
  if (/cerrado definitivamente|cerr[oó] sus puertas|permanently closed/i.test(text)) return null;
  const match = segment.evidence.find(([pattern]) => pattern.test(text));
  if (!match) return null;
  if (segment.specialty && !segment.required.test(`${site.title} ${domain}`)
    && !segment.specialty.test(site.sample)) return null;
  const published = site.emails.find(({ email, source }) => {
    const emailDomain = normalizeDomain(email.split('@').at(-1));
    return normalizeDomain(source) === domain && isValidEmail(email) && !isDemoEmail(email)
      && (emailDomain === domain || emailDomain.endsWith(`.${domain}`) || domain.endsWith(`.${emailDomain}`));
  });
  const website = pages[0];
  const contactUrl = published?.source || pages.find((page) => /\/contact(?:o|ar)?(?:[/?#]|$)/i.test(page)) || website;
  const name = [site.title, searchTitle].map((title) => String(title || '').split(/\s+[|–—]\s+|\s+\|\s*/)[0].trim())
    .find((title) => title && !/^(inicio|home|portada|bienvenidos?|sitio oficial)$/i.test(title));
  return {
    id: domain,
    name: truncate(name || domain, 88),
    website,
    contactUrl,
    email: published?.email || '',
    evidence: match[1],
  };
}

export async function findXalapaProspects(settings, key, { search = searchWebDetailed, inspect = inspectSite } = {}) {
  const segment = XALAPA_SEGMENTS[key];
  const found = new Map();
  const engines = new Set();
  const visited = new Set();
  let searchReturnedResults = false;

  for (const query of segment.queries) {
    const results = await search(settings, query, { count: 10, attempts: 2 }).catch(() => ({ results: [] }));
    if (results.engine) engines.add(results.engine);
    if (results.results.length) searchReturnedResults = true;
    const candidates = [];
    for (const result of results.results) {
      const origin = websiteOrigin(result.url);
      const domain = normalizeDomain(origin);
      if (!domain || excludedDomains.test(domain) || visited.has(domain)) continue;
      visited.add(domain);
      candidates.push({ origin, title: result.title });
      if (candidates.length === 7) break;
    }
    const verified = await Promise.allSettled(candidates.map(async ({ origin, title }) => {
      const site = await inspect(origin, { maxPages: 2 });
      return assessWebsite(site, origin, segment, title);
    }));
    for (const result of verified) {
      if (result.status === 'fulfilled' && result.value) found.set(result.value.id, result.value);
    }
    if (found.size >= 3) break;
  }

  return {
    version: XALAPA_SEARCH_VERSION,
    at: nowISO(),
    checked: visited.size,
    engines: [...engines],
    status: found.size ? 'found' : searchReturnedResults ? 'empty' : 'unavailable',
    prospects: [...found.values()].sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email))).slice(0, 8),
  };
}
