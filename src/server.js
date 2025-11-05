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

// GET /api/antt-veiculo?placa=XXX0000
app.get('/api/antt-veiculo', async (req, res) => {
  const startTime = Date.now();
  try {
    const placaRaw = String(req.query.placa || '').trim();
    if (!placaRaw) {
      return res.status(400).json({ error: 'Parâmetro "placa" é obrigatório.' });
    }

    const placa = placaRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (placa.length < 6 || placa.length > 8) {
      return res.status(400).json({ error: 'Placa inválida. Utilize somente letras e números.' });
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
    
    // Verifica se os dados essenciais estão faltando
    const isDataMissing = !data || (!data.chassi && !data.cnpj);

    if (isDataMissing) {
      // Retorna 200 OK, mas com campos nulos, indicando que a placa não foi encontrada ou dados estão incompletos.
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
    console.error(`[${req.query.placa}] ❌ Erro na consulta após ${duration}ms:`, err.message);
    res.status(500).json({ error: 'Falha ao consultar ANTT. Tente novamente mais tarde.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API ANTT rodando em http://localhost:${PORT}`);
});