/* Catálogo estático: convierte fichas existentes en una presentación navegable.
   No publica, no cobra, no envía; exporta únicamente datos comerciales públicos. */
import crypto from 'node:crypto';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean = (value, max = 300) => String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = value => clean(value, 90).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'lampara';
const tag = text => esc(clean(text, 1500));
const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12);
const asMoney = p => `${Number(p.price).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${clean(p.currency || 'ARS',5).toUpperCase()}`;

function imageType(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0,3).toString('hex') === 'ffd8ff') return 'jpg';
  if (buffer.length >= 8 && buffer.subarray(0,8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'webp';
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))) return 'gif';
  return null;
}

function csv(rows) {
  const cols = ['codigo','nombre','precio','moneda','pagina','imagen','estado'];
  const quote = value => {
    const text = String(value ?? '');
    // Evita inyección de fórmulas al abrir el archivo en Excel.
    const safe = /^[\t\r\n =+@\-]/.test(text) && /^[\s]*[=+@\-]/.test(text) ? "'" + text : text;
    return `"${safe.replace(/"/g,'""')}"`;
  };
  return '\uFEFF'+[cols.join(','), ...rows.map(row=>cols.map(col=>quote(row[col])).join(','))].join('\r\n')+'\r\n';
}

const STYLES = `:root{color-scheme:light;--bg:#f8f6f0;--paper:#fff;--ink:#202320;--soft:#5a635a;--accent:#244d3f;--line:#dde0d9}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink)}a{color:inherit}.wrap{max-width:1200px;margin:0 auto;padding:24px}.top{border-bottom:1px solid var(--line);background:var(--paper)}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px}.logo{font-size:1.35rem;font-weight:800;text-decoration:none;letter-spacing:-.03em}.muted,.note{color:var(--soft)}.note{font-size:.87rem}.hero{padding:55px 0 27px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:.79rem;font-weight:700;color:var(--accent)}h1{font-size:clamp(2rem,5.4vw,4.5rem);letter-spacing:-.04em;line-height:1.09;margin:.24em 0}h2{font-size:clamp(1.5rem,3vw,2.5rem);line-height:1.2}.lede{font-size:1.12rem;color:var(--soft);max-width:720px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:20px 0 40px}.card{background:var(--paper);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px #00000008}.card img{width:100%;aspect-ratio:4/3;display:block;object-fit:cover;background:#efeee9}.card-content{padding:20px}.card h2{font-size:1.29rem;margin:0 0 5px}.price{font-weight:800;color:var(--accent);font-size:1.24rem}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;border:1px solid var(--accent);background:var(--accent);color:white;text-decoration:none;border-radius:10px;font-weight:700;min-height:44px}.button.secondary{color:var(--accent);background:transparent}.button:focus-visible,a:focus-visible{outline:3px solid #c77e32;outline-offset:3px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.detail{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(290px,1fr);gap:42px;align-items:start;padding:35px 0}.detail img{width:100%;border-radius:18px;border:1px solid var(--line)}.facts{padding:0;list-style:none}.facts li{padding:10px 0;border-bottom:1px solid var(--line)}.foot{border-top:1px solid var(--line);padding:28px 0;margin-top:40px}.small{font-size:.9rem}.pill{font-size:.76rem;display:inline-block;border:1px solid var(--line);border-radius:20px;padding:3px 10px;color:var(--soft)}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.detail{grid-template-columns:1fr}}@media(max-width:550px){.grid{grid-template-columns:1fr}.wrap{padding:18px}.hero{padding:35px 0 12px}.top .wrap{padding-block:12px}}`;
const SCRIPT = `(()=>{const qs=new URLSearchParams(location.search);const clip=v=>String(v||'').replace(/[^a-z0-9_-]/gi,'').slice(0,40);const src=clip(qs.get('utm_source'))||'catalogo';const camp=clip(qs.get('utm_campaign'))||'';document.querySelectorAll('[data-product-link]').forEach(a=>{const link=new URL(a.getAttribute('href'),location.href);link.searchParams.set('utm_source',src);if(camp)link.searchParams.set('utm_campaign',camp);a.href=link.href;});document.querySelectorAll('[data-contact]').forEach(a=>{const msg=a.dataset.message+'\\nOrigen: '+src+(camp?' / '+camp:'');if(a.dataset.contact==='wa')a.href='https://wa.me/'+a.dataset.phone+'?text='+encodeURIComponent(msg);else if(a.dataset.contact==='mail')a.href='mailto:'+a.dataset.email+'?subject='+encodeURIComponent('Consulta por '+a.dataset.item)+'&body='+encodeURIComponent(msg);});})();`;

function getContact(product, kind, option, source = 'catalogo') {
  const code = clean(product.code || product.name, 95);
  const msg = `Hola, vi la lámpara ${clean(product.name, 85)} (ref. ${code}). Quisiera consultar precio final, disponibilidad y entrega.\nOrigen: ${source}`;
  if (kind === 'wa') return `https://wa.me/${option.whatsapp}?text=${encodeURIComponent(msg)}`;
  return `mailto:${encodeURIComponent(option.email).replace(/%40/g,'@')}?subject=${encodeURIComponent('Consulta: '+clean(product.name,85))}&body=${encodeURIComponent(msg)}`;
}

function buttons(product, option) {
  const message = `Hola, vi la lámpara ${clean(product.name, 85)} (ref. ${clean(product.code || product.id, 80)}). Quisiera consultar precio final, disponibilidad y entrega.`;
  const set=[];
  if(option.whatsapp)set.push(`<a class="button" rel="noopener noreferrer" data-contact="wa" data-phone="${esc(option.whatsapp)}" data-item="${esc(product.name)}" data-message="${esc(message)}" href="${esc(getContact(product,'wa',option))}">Consultar por WhatsApp</a>`);
  if(option.email)set.push(`<a class="button secondary" data-contact="mail" data-email="${esc(option.email)}" data-item="${esc(product.name)}" data-message="${esc(message)}" href="${esc(getContact(product,'mail',option))}">Consultar por correo</a>`);
  return `<div class="actions">${set.join('')}</div>`;
}
function shell(title,body,option,{root=false,desc=''}={}) {
  const home = root ? 'index.html' : '../index.html';
  const css = root ? 'assets/site.css':'../assets/site.css';
  const js = root ? 'assets/site.js':'../assets/site.js';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="${esc(clean(desc || option.intro,155))}"><title>${esc(title)} · ${esc(option.brand)}</title><link rel="stylesheet" href="${css}"></head><body><header class="top"><div class="wrap"><a class="logo" href="${home}">${esc(option.brand)}</a><span class="small muted">Diseño y fabricación de lámparas</span></div></header><main class="wrap">${body}</main><footer class="foot"><div class="wrap"><b>${esc(option.brand)}</b><p class="note">Precios orientativos. Consultá disponibilidad, medios de pago, costos de envío y plazos antes de confirmar una compra.</p></div></footer><script defer src="${js}"></script></body></html>`;
}

/** readMedia(rel) debe devolver un Buffer leído desde el directorio permitido. */
export async function buildPublicCatalog(products, raw={}, readMedia) {
  if(!Array.isArray(products) || typeof readMedia !== 'function')throw new TypeError('No hay catálogo o lector de fotografías válido.');
  const option={brand:clean(raw.brand||'Lámparas de diseño',65),intro:clean(raw.intro||'Lámparas de diseño fabricadas a pedido. Conocé las piezas y consultá sus características.',380),whatsapp:'',email:''};
  const phone=clean(raw.whatsapp,30).replace(/[\s()+-]/g,'');
  if(phone&&!/^\d{8,15}$/.test(phone))throw new RangeError('El WhatsApp debe llevar código de país y de 8 a 15 dígitos; ejemplo 54911XXXXXXXX.');
  const email=clean(raw.email,120).toLowerCase();
  if(email&&!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(email))throw new RangeError('Ingresá un correo comercial válido.');
  if(!phone&&!email)throw new RangeError('Configurá al menos un WhatsApp o correo para recibir consultas.');
  option.whatsapp=phone;option.email=email;
  const requested=Array.isArray(raw.productIds)?new Set(raw.productIds.map(String)):null;
  const selected=products.filter(p=>p&&!p.demo&&p.status!=='archivado'&&(!requested||requested.has(String(p.id))));
  if(requested&&selected.length!==requested.size)throw new RangeError('La selección contiene lámparas inexistentes o archivadas. Actualizá el catálogo.');
  if(!selected.length)throw new RangeError('No hay lámparas activas seleccionadas.');
  const overrides=(raw.priceOverrides&&typeof raw.priceOverrides==='object'&&!Array.isArray(raw.priceOverrides))?raw.priceOverrides:{};
  const activeIds=new Set(selected.map(p=>String(p.id)));
  for(const [id,value] of Object.entries(overrides)){
    if(!activeIds.has(id))throw new RangeError('Hay un precio especial para una lámpara no seleccionada.');
    const n=Number(value);
    if(value===null || value==='' || !Number.isFinite(n) || n<=0 || n>1e9 || Math.abs(n*100-Math.round(n*100))>0.00001)
      throw new RangeError('El precio especial debe ser positivo, tener hasta dos decimales y pertenecer a una lámpara seleccionada.');
  }
  const excluded=[];const published=[];const images=new Map();let bytes=0;
  for(const original of selected){
    const product=Object.hasOwn(overrides,String(original.id))?{...original,price:Number(overrides[original.id])}:original;
    const reasons=[];
    if(!(Number(product.price)>0))reasons.push('falta precio positivo');
    const photo=Array.isArray(product.photos)?product.photos.find(p=>p?.file):null;
    if(!photo)reasons.push('falta fotografía');
    if(reasons.length){excluded.push({id:product.id,name:clean(product.name),reasons});continue;}
    try{
      const image=await readMedia(photo.file);
      if(!Buffer.isBuffer(image))throw Error('foto no disponible');
      if(image.length>10*1024*1024)throw Error('foto supera 10 MB');
      const ext=imageType(image);
      if(!ext)throw Error('foto no admitida (JPG, PNG, WEBP o GIF)');
      const imageRel=`assets/${hash(photo.file)}.${ext}`;
      if(!images.has(imageRel)){
        if(bytes+image.length>110*1024*1024)throw Error('catálogo supera 110 MB en fotografías; optimizá las portadas');
        images.set(imageRel,image);bytes+=image.length;
      }
      const page=`productos/${slug(product.name)}-${hash(product.id).slice(0,8)}.html`;
      published.push({product,imageRel,page});
    }catch(error){excluded.push({id:product.id,name:clean(product.name),reasons:[`foto ilegible: ${clean(error.message,150)}`]});}
  }
  if(!published.length)throw new RangeError('Ninguna lámpara tiene fotografía y precio para crear la web. Revisá las fichas y fotos.');
  const rows=published.map(({product:p,imageRel,page})=>({codigo:p.code||p.id,nombre:p.name,precio:p.price,moneda:p.currency||'ARS',pagina:page,imagen:imageRel,estado:'BORRADOR SIN PUBLICAR'}));
  const cards=published.map(({product:p,imageRel,page})=>`<article class="card"><a data-product-link href="${esc(page)}"><img loading="lazy" src="${esc(imageRel)}" alt="${esc(clean(p.photos[0]?.alt||p.name,120))}"></a><div class="card-content"><span class="pill">${esc(clean(p.category||'Lámpara',50))}</span><h2><a href="${esc(page)}">${esc(clean(p.name,100))}</a></h2><p class="price">${esc(asMoney(p))}</p><p class="small muted">${tag(p.description||'Consultá materiales, medidas y condiciones.')}</p><a data-product-link class="button" href="${esc(page)}">Ver lámpara</a></div></article>`).join('');
  const index=shell('Catálogo de lámparas',`<section class="hero"><p class="eyebrow">Colección de lámparas</p><h1>${esc(option.brand)}</h1><p class="lede">${esc(option.intro)}</p><p class="note">${published.length} piezas con fotografías y precio de referencia. Consultá condiciones antes de realizar tu pedido.</p></section><section aria-label="Productos"><div class="grid">${cards}</div></section>`,option,{root:true});
  const entries=[{name:'index.html',data:index},{name:'assets/site.css',data:STYLES},{name:'assets/site.js',data:SCRIPT},{name:'catalogo-enlaces.csv',data:csv(rows)}];
  for(const [name,data] of images)entries.push({name,data});
  for(const {product:p,imageRel,page} of published){
    const facts=[p.code?`Código: ${clean(p.code,100)}`:'',p.materials?`Materiales: ${clean(p.materials,180)}`:'',p.dimensions?`Medidas: ${clean(p.dimensions,180)}`:'',Number(p.leadTimeDays)>0?`Plazo de fabricación informado: ${Number(p.leadTimeDays)} días, sujeto a confirmación`:''].filter(Boolean);
    const details=facts.length?`<ul class="facts">${facts.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p>Solicitá medidas, materiales y plazo de fabricación.</p>';
    const body=`<p><a href="../index.html">← Volver al catálogo</a></p><article class="detail"><div><img src="../${esc(imageRel)}" alt="${esc(clean(p.photos[0]?.alt||p.name,120))}"></div><div><p class="eyebrow">${esc(clean(p.category||'Lámpara',80))}</p><h1>${esc(clean(p.name,110))}</h1><p class="price">${esc(asMoney(p))}</p><p class="note">Precio de referencia. Consultar disponibilidad, envío y medios de pago.</p><p>${tag(p.description||'Pieza de iluminación decorativa. Consultá datos técnicos y opciones disponibles.')}</p>${details}${buttons(p,option)}<p class="note">Esta página permite consultar, no procesa pagos en línea.</p></div></article>`;
    entries.push({name:page,data:shell(p.name,body,option,{desc:p.description})});
  }
  entries.push({name:'LEER-ANTES-DE-PUBLICAR.txt',data:`LUCIAN — CATÁLOGO ESTÁTICO LISTO PARA REVISAR\n\n${published.length} lámparas exportadas, ${excluded.length} excluidas por ficha o foto.\n\nCÓMO PROBAR: Abrí index.html en tu navegador.\nCÓMO PUBLICAR: Subí TODOS los archivos conservando las carpetas a un hosting HTTPS público de tu propiedad o de una plataforma de tiendas. Las rutas del catálogo funcionan dentro de una carpeta o dominio.\nDESPUÉS: colocá la URL pública en el perfil de Instagram o tus publicaciones. Podés agregar ?utm_source=instagram&utm_campaign=coleccion a la URL. Al hacer clic en WhatsApp, el texto incluye esa procedencia. NO es un sistema de estadísticas de clics ni capta datos personales.\nCONTACTO: WhatsApp ${option.whatsapp||'(no configurado)'} / Correo ${option.email||'(no configurado)'}\n\nADVERTENCIA: Este sitio NO tiene carrito, pago validado, stock confirmado, política de devoluciones ni integración de envíos. No equivale a una ficha apta para Google Merchant Center: necesitás requisitos adicionales, incluida una forma válida de comprar y datos consistentes. No publicar afirmaciones técnicas ni reseñas que no puedas documentar.\n\nPRECIOS DE LA PUBLICACIÓN: se fijan al exportar; si se cambian los precios en Lucian, es necesario volver a exportar y publicar la web.

LÁMPARAS EXCLUIDAS:\n${excluded.map(x=>`- ${x.name}: ${x.reasons.join('; ')}`).join('\n')||'Ninguna'}\n`});
  return {entries, count:published.length, excluded, images:images.size, bytes, contact:{whatsapp:Boolean(option.whatsapp),email:Boolean(option.email)}};
}
