import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.mjs';
import { fetchGalapaCatalog, syncGalapaCatalog } from '../lib/galapa-catalog.mjs';

try {
  if (process.argv.includes('--apply')) {
    const data = process.env.LUCIAN_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url));
    const store = await new Store(path.resolve(data)).init();
    const result = await syncGalapaCatalog(store);
    await store.setMeta({ galapaInitialized: true });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const items = await fetchGalapaCatalog();
    const active = items.filter(item => item.available).length;
    console.log(JSON.stringify({ total: items.length, active, unavailable: items.length - active }, null, 2));
  }
} catch (error) {
  console.error(`GALAPA: ${error.message}`);
  process.exitCode = 1;
}
