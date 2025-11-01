import { fetchAnttByPlate } from '../scraper/antt.js';

const placa = process.argv[2] || 'JAA4B41';

(async () => {
  const data = await fetchAnttByPlate(placa);
  console.log(JSON.stringify({ placa, ...data }, null, 2));
})();