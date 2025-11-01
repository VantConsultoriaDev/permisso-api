import express from 'express';
import { fetchAnttByPlate } from './scraper/antt.js';

const app = express();

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// GET /api/antt-veiculo?placa=XXX0000
app.get('/api/antt-veiculo', async (req, res) => {
  try {
    const placaRaw = String(req.query.placa || '').trim();
    if (!placaRaw) {
      return res.status(400).json({ error: 'Parâmetro "placa" é obrigatório.' });
    }

    const placa = placaRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (placa.length < 6 || placa.length > 8) {
      return res.status(400).json({ error: 'Placa inválida. Utilize somente letras e números.' });
    }

    // Retry estrito por padrão, com timeout máximo configurável via env
    process.env.RETRY_STRICT = process.env.RETRY_STRICT ?? 'true';
    process.env.RETRY_TOTAL_TIMEOUT_MS = process.env.RETRY_TOTAL_TIMEOUT_MS ?? '90000';
    const data = await fetchAnttByPlate(placa);
    if (!data) {
      return res.status(404).json({ error: 'Veículo não encontrado ou página indisponível.' });
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
    console.error('Erro na consulta:', err);
    res.status(500).json({ error: 'Falha ao consultar ANTT.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API ANTT rodando em http://localhost:${PORT}`);
});