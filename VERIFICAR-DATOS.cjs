// Solo lectura de los datos reales: nunca escribe ni genera registros.
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'server.mjs'))) {
  console.error('No se encontro el servidor del Lucian elegido.');
  process.exit(2);
}
const counts = {};
for (const name of ['products', 'threads', 'missions', 'content']) {
  const file = path.join(root, 'data', name + '.json');
  if (!fs.existsSync(file)) {
    if (name === 'products') { console.error('Falta el catalogo products.json.'); process.exit(3); }
    counts[name] = 0;
    continue;
  }
  try {
    const value = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(value)) throw new Error('La raiz debe ser una lista de registros.');
    counts[name] = value.length;
  } catch (error) {
    console.error(`${name}.json no pudo validarse: ${error.message}`);
    process.exit(4);
  }
}
process.stdout.write(JSON.stringify(counts));
