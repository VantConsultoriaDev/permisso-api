import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAnttByPlate } from './scraper/antt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Root route serves the index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Reusable function to handle ANTT query logic
async function handleAnttQuery(placaRaw, res) {
  const startTime = Date.now();
  try {
    if (!placaRaw) {
      return res.status(400).json({ error: 'Parâmetro "placa" é obrigatório.' });
    }

    const placa = placaRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Valida o formato da placa (padrão Mercosul e tradicional)
    const placaRegex = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
    if (!placaRegex.test(placa)) {
      return res.status(400).json({ error: 'Formato de placa inválido. O formato esperado é ABC1D23.' });
    }

    // Forçar modo de depuração para obter logs detalhados do scraper
    process.env.DEBUG_SCRAPER = 'true';
    
    // Retry estrito por padrão, com timeout máximo configurável via env
    process.env.RETRY_STRICT = process.env.RETRY_STRICT ?? 'true';
    process.env.RETRY_TOTAL_TIMEOUT_MS = process.env.RETRY_TOTAL_TIMEOUT_MS ?? '90000';
    
    console.log(`[${placa}] ⏳ Iniciando consulta ANTT...`);
    const data = await fetchAnttByPlate(placa);
    const duration = Date.now() - startTime;
    console.log(`[${placa}] ✅ Consulta finalizada em ${duration}ms.`);
    
    const isDataMissing = !data || (!data.chassi && !data.cnpj);

    if (isDataMissing) {
      return res.json({
        placa,
        chassi: null,
        cnpj: null,
        razaoSocial: null,
        nomeFantasia: null,
        endereco: null,
        fonte: 'https://scff.antt.gov.br/conPlaca.asp'
      });
    }

    return res.json({
      placa,
      chassi: data.chassi || null,
      cnpj: data.cnpj || null,
      razaoSocial: data.razaoSocial || null,
      nomeFantasia: data.nomeFantasia || null,
      endereco: data.enderecoCompleto || null,
      fonte: 'https://scff.antt.gov.br/conPlaca.asp'
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[${placaRaw}] ❌ Erro na consulta após ${duration}ms:`, err.message);
    res.status(500).json({ error: 'Falha ao consultar ANTT. Tente novamente mais tarde.' });
  }
}

// GET /api/antt-veiculo?placa=XXX0000 (Existing route using query parameter)
app.get('/api/antt-veiculo', async (req, res) => {
  await handleAnttQuery(req.query.placa, res);
});

// GET /api/antt-veiculo/:placa (Existing route using path parameter)
app.get('/api/antt-veiculo/:placa', async (req, res) => {
  await handleAnttQuery(req.params.placa, res);
});

// GET /api/:placa (New, simplified route using path parameter)
app.get('/api/:placa', async (req, res) => {
  await handleAnttQuery(req.params.placa, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API ANTT rodando em http://localhost:${PORT}`);
});