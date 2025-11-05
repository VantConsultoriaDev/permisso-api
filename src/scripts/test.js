import { fetchAnttByPlate } from '../scraper/antt.js';

const placa = process.argv[2] || 'GZG1097';

(async () => {
  console.log(`Iniciando teste para a placa: ${placa}`);
  const data = await fetchAnttByPlate(placa);
  console.log(JSON.stringify({ placa, ...data }, null, 2));
})();