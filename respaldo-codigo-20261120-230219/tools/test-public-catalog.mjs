import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildPublicCatalog } from '../lib/public-catalog.mjs';
import { createZip, readZip } from '../lib/zip.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X+4sAAAAASUVORK5CYII=','base64');
const source=(id,extra={})=>({id,name:`Lámpara ${id}`,code:`SKU${id}`,price:15000,currency:'ARS',description:'Pieza de diseño, consultar entrega.',photos:[{file:`products/${id}.png`,alt:'foto portada'}],...extra});
const arr=[source('a'),source('b',{name:'<img src=x onerror=alert(1)>',description:'<script>alert(1)</script>'}),source('c',{price:0}),source('d',{photos:[]}),source('e',{status:'archivado'}),source('f',{demo:true})];
const opt={whatsapp:'+54 9 11 4444 5555',email:'ventas@example.com',brand:'LUCIAN <STYLE>',intro:'Diseños de autor'};
const original=JSON.stringify(arr);
const site=await buildPublicCatalog(arr,opt,async()=>png);
assert.equal(site.count,2);
assert.equal(site.excluded.length,2);
assert.equal(site.images,2);
assert.equal(JSON.stringify(arr),original,'No modifica el catálogo');
const files=new Map(site.entries.map(x=>[x.name,x.data]));
assert.ok(files.has('index.html'));
assert.ok(files.has('assets/site.css'));
assert.ok(files.has('assets/site.js'));
assert.equal(files.size,9,'sitio+CSV+2 fotos+2 fichas+guía');
const index=String(files.get('index.html'));
assert.ok(index.includes('LUCIAN &lt;STYLE&gt;'));
assert.ok(index.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!index.includes('<img src=x onerror=alert(1)>'));
assert.ok(index.includes('productos/'));
assert.ok(!index.includes('60000'));
const productPage=[...files.keys()].find(x=>x.startsWith('productos/') && x.includes('lampara-a'));
assert.ok(productPage);
const page=String(files.get(productPage));
assert.ok(page.includes('https://wa.me/5491144445555'));
assert.ok(page.includes('mailto:ventas@example.com'));
assert.ok(page.includes('data-contact="wa"'));
assert.ok(!page.includes('apiKey'));
new vm.Script(String(files.get('assets/site.js')));
assert.ok(String(files.get('assets/site.js')).includes('utm_source'));
const productLink={ getAttribute:()=> 'productos/lampara-a.html', href:'' };
const whatsappLink={ dataset:{contact:'wa',phone:'5491144445555',message:'Hola, lámpara A'}, href:'' };
const sandbox={URL,URLSearchParams,location:{href:'https://lamparas.test/index.html?utm_source=instagram&utm_campaign=primavera',search:'?utm_source=instagram&utm_campaign=primavera'},document:{querySelectorAll:selector=>selector==='[data-product-link]'?[productLink]:selector==='[data-contact]'?[whatsappLink]:[]}};
vm.runInNewContext(String(files.get('assets/site.js')),sandbox);
assert.ok(productLink.href.includes('utm_source=instagram'));
assert.ok(productLink.href.includes('utm_campaign=primavera'));
assert.ok(decodeURIComponent(whatsappLink.href).includes('Origen: instagram / primavera'));

assert.ok(String(files.get('catalogo-enlaces.csv')).includes('BORRADOR SIN PUBLICAR'));
const roundtrip=readZip(createZip(site.entries));
assert.equal(roundtrip.length,site.entries.length);
assert.deepEqual(roundtrip.find(x=>x.name==='index.html').data,Buffer.from(index));
const cases=[
 [{whatsapp:'123',email:''},'WhatsApp'],
 [{whatsapp:'',email:''},'WhatsApp'],
 [{whatsapp:'',email:'x@y'},'correo'],
 [{...opt,productIds:['not-real']},'selección'],
 [{...opt,productIds:[]},'No hay lámparas'],
];
for(const [args,word] of cases)await assert.rejects(buildPublicCatalog(arr,args,async()=>png),e=>String(e.message).includes(word));
const special=await buildPublicCatalog(arr,{...opt,priceOverrides:{a:1234.50}},async()=>png);
const specialPage=String(special.entries.find(x=>x.name.includes('lampara-a-')).data);
assert.ok(specialPage.includes('1.234,50 ARS'),'Precio especial de publicación visible');
assert.equal(arr[0].price,15000,'Precio original no cambia');
await assert.rejects(buildPublicCatalog(arr,{...opt,priceOverrides:{a:-1}},async()=>png),/precio especial/i);
await assert.rejects(buildPublicCatalog(arr,{...opt,priceOverrides:{f:100}},async()=>png),/no seleccionada/i);
const broken=await buildPublicCatalog([source('bad'),source('good')],opt,async file=>file.includes('bad')?Buffer.from('<script>'):png);
assert.equal(broken.count,1);
assert.equal(broken.excluded.length,1);
assert.equal(broken.excluded[0].id,'bad');
const many=await buildPublicCatalog(Array.from({length:135},(_,i)=>source(`num-${i}`)),{email:'ventas@example.com'},async()=>png);
assert.equal(many.count,135,'Sin tope de cantidad de lámparas');
assert.equal(many.entries.filter(x=>x.name.startsWith('productos/')).length,135);
console.log('OK public-catalog: sitio completo, imágenes, enlaces, escape HTML, exportación 135 lámparas, ZIP y selección.');
