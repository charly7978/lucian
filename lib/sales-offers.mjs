/* Motor comercial de ofertas y publicaciones. No publica, no envía y no afirma ventajas no verificadas. */
import { productReadiness } from './readiness.mjs';

const SEGMENTS = Object.freeze({
  particular: { name: 'Personas que están decorando su casa', angle: 'sumar personalidad a un ambiente', cta: 'Consultá precio, detalles y disponibilidad de esta lámpara.' },
  interiorista: { name: 'Interioristas y estudios de arquitectura', angle: 'evaluar una pieza para un proyecto', cta: 'Solicitá ficha técnica y cotización para tu proyecto.' },
  hoteleria: { name: 'Hoteles, restaurantes y espacios comerciales', angle: 'considerar iluminación decorativa para un espacio', cta: 'Pedí condiciones y plazos para tu proyecto comercial.' },
  tienda: { name: 'Tiendas de diseño y revendedores', angle: 'evaluar la incorporación de un diseño a su selección', cta: 'Consultá condiciones para locales y compras por cantidad.' },
  regalo: { name: 'Personas que buscan un regalo de diseño', angle: 'encontrar una pieza de decoración diferente', cta: 'Pedí medidas, presentación y disponibilidad antes de comprar.' },
});
const CHANNELS = Object.freeze({
  instagram: { name: 'Instagram / Facebook', format: 'Texto de publicación y guion para Reel', guide: 'Foto en ambiente + detalle del objeto + iluminación encendida; cerrá con consulta directa. Etiquetas de producto solo si tu cuenta es elegible.' },
  mercadolibre: { name: 'Mercado Libre Argentina', format: 'Título y descripción de publicación', guide: 'Revisá las comisiones reales, logística, impuestos y el simulador de Mercado Libre antes de publicar. No incluir medios de contacto externos en anuncios.' },
  pinterest: { name: 'Pinterest', format: 'Pin de inspiración con título', guide: 'Usá una foto vertical auténtica y un enlace público directo a la ficha del producto; los catálogos necesitan URLs accesibles.' },
  google: { name: 'Google Merchant Center', format: 'Borrador para ficha de producto', guide: 'Necesitás una página pública con el mismo precio, moneda, imagen, disponibilidad, medios de compra y políticas. Este kit no equivale a una publicación aprobada.' },
  etsy: { name: 'Etsy', format: 'Borrador de anuncio de pieza de diseño', guide: 'Comprobá las normas de creatividad y autoría de Etsy para diseños 3D, así como medios de cobro y envíos internacionales.' },
  b2b: { name: 'Presentación comercial B2B', format: 'Propuesta para profesionales', guide: 'Usá esta propuesta ante contactos que solicitaron información o por canales habilitados. No implica autorización para emails no solicitados.' },
  whatsapp: { name: 'WhatsApp / consultas entrantes', format: 'Respuesta personalizada a consulta', guide: 'Usar ante una consulta recibida o con permiso válido. No automatizar mensajes masivos no solicitados.' },
});
const round = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const safe = (v, length = 250) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length);
const money = (value, currency) => `${Number(value).toFixed(2)} ${currency}`;
function positive(input, key, maximum = 1e9) {
  if (input === undefined || input === '' || input === null) return 0;
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new RangeError(`El valor ${key} debe estar entre 0 y ${maximum}.`);
  return value;
}
function percentage(input, key, maximum = 80) {
  const value = positive(input, key, maximum);
  return value;
}

export function buildOfferKit(product, raw = {}) {
  if (!product || !product.id) throw new TypeError('Elegí una lámpara válida.');
  const segment = SEGMENTS[raw.segment] ? raw.segment : 'particular';
  const channel = CHANNELS[raw.channel] ? raw.channel : 'instagram';
  const basePrice = positive(product.price, 'precio del catálogo');
  const hasOverride = raw.priceOverride !== undefined && raw.priceOverride !== null && raw.priceOverride !== '';
  const selectedPrice = hasOverride ? positive(raw.priceOverride, 'precio especial') : basePrice;
  const discountPct = percentage(raw.discountPercent, 'descuento');
  const platformFeePct = percentage(raw.platformFeePercent, 'comisión comercial', 70);
  const paymentFeePct = percentage(raw.paymentFeePercent, 'comisión de cobro', 30);
  if (platformFeePct + paymentFeePct >= 95) throw new RangeError('Las comisiones no pueden absorber el 95% o más del precio.');
  const packagingCost = positive(raw.packagingCost, 'embalaje');
  const shippingSubsidy = positive(raw.shippingSubsidy, 'envío a cargo del vendedor');
  const adCostPerSale = positive(raw.adCostPerSale, 'publicidad por venta');
  const sellingPrice = round(selectedPrice * (1 - discountPct / 100));
  const productionCost = Number(product.cost) > 0 ? Number(product.cost) : null;
  const fee = round(sellingPrice * (platformFeePct + paymentFeePct) / 100);
  const fixedCost = round(packagingCost + shippingSubsidy + adCostPerSale);
  const estimatedProfit = productionCost === null ? null : round(sellingPrice - productionCost - fee - fixedCost);
  const estimatedMarginPct = estimatedProfit === null || sellingPrice === 0 ? null : round(100 * estimatedProfit / sellingPrice);
  const breakEvenPrice = productionCost === null ? null : round((productionCost + fixedCost) / (1 - (platformFeePct + paymentFeePct) / 100));
  const currency = safe(product.currency || 'ARS', 6).toUpperCase();
  const name = safe(product.name, 100) || 'Lámpara sin nombre';
  const description = safe(product.description, 1100);
  const materials = safe(product.materials, 200);
  const dimensions = safe(product.dimensions, 180);
  const weight = Number(product.weightGrams) > 0 ? `${Number(product.weightGrams)} g` : '';
  const costsVerified = raw.costsVerified === true || raw.costsVerified === 'on';
  const leadDays = Number(product.leadTimeDays) > 0 ? Number(product.leadTimeDays) : null;
  const capacity = Number(product.capacityPerWeek) > 0 ? Number(product.capacityPerWeek) : null;
  const headline = `Lámpara de diseño ${name}`.slice(0, 105);
  const segmentData = SEGMENTS[segment];
  const channelData = CHANNELS[channel];
  const details = [materials ? `Materiales: ${materials}.` : '', dimensions ? `Medidas: ${dimensions}.` : '', weight ? `Peso aproximado informado: ${weight}.` : '', leadDays ? `Plazo de fabricación informado: ${leadDays} días (confirmar disponibilidad).` : 'Consultar disponibilidad y plazo de entrega.', capacity && ['tienda', 'hoteleria'].includes(segment) ? `Capacidad de producción informada: ${capacity} unidades por semana (sujeta a confirmación).` : ''].filter(Boolean);
  const priceText = sellingPrice > 0 ? money(sellingPrice, currency) : 'Precio a confirmar';
  const caption = `${headline}. Una pieza para ${segmentData.angle}. ${description ? `${description} ` : ''}Precio de referencia: ${priceText}. ${segmentData.cta}`;
  const listing = [headline, '', description || 'Lámpara de diseño. Consultá su ficha técnica para conocer el producto.', '', ...details, '', `Precio de esta oferta: ${priceText}.`, '', segmentData.cta].join('\n');
  const pitch = [`Asunto: ${name} — consulta de iluminación decorativa`, '', `Hola,`, '', `Te comparto ${name}, una lámpara de diseño que puede resultar interesante para ${segmentData.angle}.`, description || 'Puedo facilitarte imágenes y datos técnicos para evaluar si encaja.', ...(details.length ? ['', ...details.slice(0, 3)] : []), '', `Precio orientativo: ${priceText}.`, segmentData.cta, '', 'Esta propuesta es un borrador para adaptar al destinatario y enviar únicamente por un canal permitido.'].join('\n');
  const hooks = [
    `¿Buscás una lámpara que también aporte diseño al ambiente? Conocé ${name}.`,
    `Una idea para renovar un rincón: luz, forma y materiales. ${name}.`,
    `Antes de elegir iluminación decorativa, mirá la forma, las medidas y cómo queda encendida: ${name}.`,
  ];
  const video = [`Guion orientativo para video corto de ${name}`, '0–4 s: mostrar una foto o plano del ambiente donde estará colocada; no simular escala irreal.', '4–9 s: mostrar textura y materiales reales de cerca.', '9–15 s: mostrar la lámpara encendida, si es seguro hacerlo, y sus medidas verificadas.', `Cierre: ${segmentData.cta}`, 'No afirmar potencia, ahorro, certificaciones ni seguridad eléctrica sin documentación.'].join('\n');
  const responses = {
    precio: productionCost === null ? 'Te puedo explicar el diseño, los materiales y las condiciones. Antes de ofrecer descuentos, debo verificar el costo real de fabricación.' : 'Te comparto materiales, medidas y alternativas de cantidad. Si el presupuesto lo requiere, revisamos una propuesta sin comprometer la calidad.',
    entrega: leadDays ? `El plazo de fabricación registrado es de ${leadDays} días; antes de confirmar un pedido debo verificar capacidad y envío al destino.` : 'Confirmo el plazo real de fabricación y la entrega al conocer la cantidad y el destino.',
    mayorista: 'Podemos preparar una cotización por cantidad con precio, plazos y condiciones explícitas. No prometemos descuentos ni stock sin verificarlo.',
    seguridad: 'Te comparto la documentación técnica y las especificaciones disponibles; si faltan, las verifico antes de afirmar compatibilidad o certificación.',
  };
  const missing = [];
  if (!Array.isArray(product.photos) || !product.photos.length) missing.push('Falta al menos una fotografía real.');
  if (sellingPrice <= 0) missing.push('Falta un precio válido para la oferta.');
  if (productionCost === null) missing.push('Falta cargar el costo de fabricación: no se puede calcular rentabilidad.');
  if (!dimensions) missing.push('Faltan medidas para consultas comerciales y envíos.');
  if (!leadDays) missing.push('Falta establecer o confirmar el plazo de fabricación.');
  if (!description) missing.push('La descripción del producto está vacía.');
  if (estimatedProfit !== null && estimatedProfit <= 0) missing.push('La oferta tiene margen estimado nulo o negativo. No activar publicidad sin corregirlo.');
  if (discountPct > 0) missing.push('Verificá que el descuento y su vigencia sean reales y estén autorizados.');
  if (['google', 'pinterest'].includes(channel) && !raw.publicProductUrl) missing.push('Falta URL pública de la ficha: el navegador local de Lucian no es un enlace para compradores.');
  if (raw.publicProductUrl && !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(String(raw.publicProductUrl))) throw new RangeError('La URL pública del producto debe comenzar con https://.');
  if (channel === 'etsy') missing.push('Verificar autoría/diseño, elegibilidad de Etsy, políticas y envío internacional antes de publicar.');
  const readiness = productReadiness(product);
  if (!costsVerified) missing.push('Revisá y confirmá los costos, las comisiones y los gastos antes de evaluar anuncios pagados.');
  if (adCostPerSale === 0) missing.push('Para publicidad paga, estimá también el costo real por venta.');
  const canSpendOnAds = Boolean(readiness.readyForProspecting && productionCost !== null && estimatedProfit > 0 && dimensions && leadDays && costsVerified && adCostPerSale > 0);
  const kit = {
    productId: product.id, productName: name, sku: safe(product.code, 80), channel, channelName: channelData.name, segment, segmentName: segmentData.name,
    format: channelData.format, guide: channelData.guide,
    pricing: { currency, catalogPrice: round(basePrice), priceBeforeDiscount: round(selectedPrice), discountPercent: discountPct, offerPrice: sellingPrice, manufacturingCost: productionCost, platformFeePercent: platformFeePct, paymentFeePercent: paymentFeePct, feeEstimated: fee, packagingCost, shippingSubsidy, adCostPerSale, fixedCost, estimatedProfit, estimatedMarginPct, breakEvenPrice, feeNote: 'Simulación manual: no consulta tarifas reales ni calcula impuestos adicionales. Confirmá comisiones, tributos y costos logísticos con cada plataforma.' },
    content: { title: headline, listing, caption, pitch, hooks, video, responses, cta: segmentData.cta },
    audit: { missing, canSpendOnAds, hasPhoto: !!product.photos?.length, score: readiness.score, published: false, message: 'Borrador no publicado. Para vender debe existir un canal de compra o consulta real y autorizado.' },
    disclaimer: 'Sin promesas de stock, reseñas, certificaciones, urgencias, garantías o descuentos no comprobados. No publica ni envía mensajes.',
  };
  return kit;
}

export function buildChannelReadiness(products = []) {
  const active = products.filter(p => p?.id && !p.demo && p.status !== 'archivado');
  const flags = { missingPhotos: 0, missingCost: 0, missingDimensions: 0, missingLeadTime: 0, missingPrice: 0 };
  for (const p of active) {
    if (!p.photos?.length) flags.missingPhotos++;
    if (!(Number(p.cost) > 0)) flags.missingCost++;
    if (!safe(p.dimensions)) flags.missingDimensions++;
    if (!(Number(p.leadTimeDays) > 0)) flags.missingLeadTime++;
    if (!(Number(p.price) > 0)) flags.missingPrice++;
  }
  return { products: active.length, ...flags, reviewNeeded: Object.values(flags).some(n=>n>0),
    nextStep: flags.missingPhotos ? 'Completar fotografías de las lámparas elegidas para publicar.' : flags.missingPrice ? 'Definir los precios del catálogo.' : flags.missingCost ? 'Cargar costos reales para evitar ventas con pérdidas.' : flags.missingDimensions ? 'Completar medidas de las fichas.' : flags.missingLeadTime ? 'Confirmar plazos de fabricación.' : 'Preparar fichas comerciales y seleccionar canales de publicación.',
    note: 'Esto no verifica tiendas conectadas, URLs públicas, documentación eléctrica, proveedores, envíos ni aprobaciones de plataformas.' };
}

export const SALES_SEGMENTS = Object.entries(SEGMENTS).map(([id, item]) => ({ id, name: item.name }));
export const SALES_CHANNELS = Object.entries(CHANNELS).map(([id, item]) => ({ id, name: item.name }));

/* Exportador masivo deliberadamente genérico: no es un feed aprobado por ninguna plataforma. */
export function buildBulkOfferRows(products = [], raw = {}) {
  const ids = Array.isArray(raw.productIds) ? new Set(raw.productIds.map(String)) : null;
  const selected = products.filter(p => p?.id && !p.demo && p.status !== 'archivado' && (!ids || !ids.size || ids.has(p.id)));
  const rows = selected.map(p => {
    const kit = buildOfferKit(p, raw);
    return {
      id: p.id, sku: kit.sku, producto: kit.productName, canal: kit.channelName, comprador: kit.segmentName,
      titulo: kit.content.title, precio: kit.pricing.offerPrice, moneda: kit.pricing.currency,
      costo: kit.pricing.manufacturingCost ?? '', ganancia_estimada: kit.pricing.estimatedProfit ?? '',
      margen_estimado_porcentaje: kit.pricing.estimatedMarginPct ?? '',
      texto_redes: kit.content.caption, descripcion: kit.content.listing, propuesta_profesionales: kit.content.pitch,
      guion_video: kit.content.video, observaciones: kit.audit.missing.join(' | '), listo_para_anuncios_pagados: kit.audit.canSpendOnAds ? 'Revisar manualmente' : 'NO',
      estado: 'BORRADOR SIN PUBLICAR',
    };
  });
  return { rows, selected: selected.length, omitted: products.filter(p => p?.id && (p.demo || p.status === 'archivado')).length };
}
