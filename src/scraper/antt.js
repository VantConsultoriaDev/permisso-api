import { load } from 'cheerio';
import path from 'path';
import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteerExtra.use(StealthPlugin());

const SEARCH_URL = 'https://scff.antt.gov.br/conPlaca.asp';
const RESULT_URL = 'https://scff.antt.gov.br/conLocalizaVeiculo.asp';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Connection': 'keep-alive'
};

function collectCookies(headers) {
  // Node merges multiple Set-Cookie headers into a single comma-separated string.
  const raw = headers.get('set-cookie');
  if (!raw) return '';
  // Join cookie name=value pairs only (strip attributes like Path, Expires).
  return raw
    .split(/,(?=[^;]+?=)/) // split on commas that start a new cookie
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

function sanitize(text) {
  return text ? text.replace(/\s+/g, ' ').trim() : null;
}

function getLabelValue($, label) {
  // Try exact match on a TD containing the label and read the next TD.
  const td = $(`td:contains("${label}")`).first();
  if (td.length) {
    const next = td.next('td');
    if (next.length) return sanitize(next.text());
    const parent = td.parent();
    const fallback = parent.find('td').eq(1).text();
    if (fallback) return sanitize(fallback);
  }
  // Fallback: regex search across all text
  const bodyText = $('body').text();
  const re = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*:?\s*([^\n\r]+)`, 'i');
  const m = bodyText.match(re);
  return m ? sanitize(m[1]) : null;
}

export async function fetchAnttByPlate(placa) {
  const STRICT = process.env.RETRY_STRICT ? process.env.RETRY_STRICT !== 'false' : true;
  const MAX_ATTEMPTS = parseInt(process.env.RETRY_MAX_ATTEMPTS || (STRICT ? '12' : '4'), 10);
  const TOTAL_TIMEOUT_MS = parseInt(process.env.RETRY_TOTAL_TIMEOUT_MS || (STRICT ? '90000' : '20000'), 10);

  const start = Date.now();
  let lastError = null;

  function isCompleteData(d) {
    if (!d) return false;
    const reqs = [d.chassi, d.cnpj, d.razaoSocial, d.nomeFantasia, d.enderecoCompleto];
    return reqs.every((v) => v && String(v).trim().length > 0);
  }

  async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function attemptHttp() {
    try {
      const resp1 = await fetch(SEARCH_URL, { headers: COMMON_HEADERS });
      const cookies = collectCookies(resp1.headers);
      const getUrl = `${RESULT_URL}?txtPlaca=${encodeURIComponent(placa)}`;
      let resp2 = await fetch(getUrl, {
        headers: { ...COMMON_HEADERS, Referer: SEARCH_URL, Cookie: cookies }
      });
      let html;
      if (resp2.status >= 400) {
        const form = new URLSearchParams({ txtPlaca: placa });
        const resp3 = await fetch(RESULT_URL, {
          method: 'POST',
          headers: {
            ...COMMON_HEADERS,
            Referer: SEARCH_URL,
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookies
          },
          body: form.toString()
        });
        html = await resp3.text();
      } else {
        html = await resp2.text();
      }
      const $ = load(html || '');
      const chassi = getLabelValue($, 'Chassi/Motor');
      const cnpj = getLabelValue($, 'CPNJ') || getLabelValue($, 'CNPJ');
      const razaoSocial = getLabelValue($, 'Razão Social') || getLabelValue($, 'Razao Social');
      const nomeFantasia = getLabelValue($, 'Nome Fantasia');
      const endereco = getLabelValue($, 'Endereço') || getLabelValue($, 'Endereco');
      const bairro = getLabelValue($, 'Bairro');
      const cidade = getLabelValue($, 'Cidade');
      const paisOrigem = getLabelValue($, 'País de Origem') || getLabelValue($, 'Pais de Origem');
      const enderecoCompleto = [endereco, bairro, cidade, paisOrigem].filter(Boolean).join(', ');
      const data = { chassi, cnpj, razaoSocial, nomeFantasia, enderecoCompleto };
      return data;
    } catch (err) {
      lastError = err;
      return null;
    }
  }

  async function attemptPuppeteer(mode = 'headless') {
    try {
      // Força headless sempre para não abrir janelas
      const data = await fetchWithPuppeteer(placa, { headless: 'new' });
      return data;
    } catch (err) {
      lastError = err;
      return null;
    }
  }

  const strategies = process.env.PROXY_URL ? [
    () => attemptPuppeteer('headless'),
    () => attemptHttp(),
    () => attemptPuppeteer('headless'),
    () => attemptHttp(),
  ] : [
    () => attemptHttp(),
    () => attemptPuppeteer('headless'),
    () => attemptHttp(),
    () => attemptPuppeteer('headless'),
  ];

  let bestData = { placa };
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() - start > TOTAL_TIMEOUT_MS && !STRICT) break;
    const strat = strategies[(attempt - 1) % strategies.length];
    const data = await strat();
    if (isCompleteData(data)) return data;
    
    // Coleta dados parciais se tiver mais campos que o melhor até agora
    if (data && Object.keys(data).length > Object.keys(bestData).length) {
      bestData = { placa, ...data };
    }
    
    const base = 800;
    const delay = Math.min(8000, base * Math.pow(1.6, attempt - 1) + Math.floor(Math.random() * 900));
    await sleep(delay);
  }

  // If strict, keep trying until timeout cap is reached
  while (Date.now() - start <= TOTAL_TIMEOUT_MS && STRICT) {
    const strat = strategies[Math.floor(Math.random() * strategies.length)];
    const data = await strat();
    if (isCompleteData(data)) return data;
    
    // Coleta dados parciais se tiver mais campos que o melhor até agora
    if (data && Object.keys(data).length > Object.keys(bestData).length) {
      bestData = { placa, ...data };
    }
    
    await sleep(1500 + Math.floor(Math.random() * 1200));
  }

  // Tentativa final: puppeteer headless mais uma vez
  let finalData = null;
  try {
    finalData = await attemptPuppeteer('headless');
    if (isCompleteData(finalData)) return finalData;
  } catch (e) {
    lastError = e;
    
    // Tratamento específico para erro 500 da ANTT
    if (e.message === 'ANTT_SERVER_ERROR_500') {
      if (process.env.DEBUG_SCRAPER) {
        console.log('🚨 Site da ANTT indisponível (erro 500). Tentando novamente em 5 segundos...');
      }
      await sleep(5000); // Aguarda 5 segundos antes da próxima tentativa
    }
  }

  // Usa os melhores dados coletados ou dados da tentativa final
  if (finalData && Object.keys(finalData).length > Object.keys(bestData).length) {
    bestData = { placa, ...finalData };
  }
  
  // Log detalhado para debug
  if (process.env.DEBUG_SCRAPER === 'true') {
    console.log('🔍 Debug - Dados extraídos:', JSON.stringify(bestData, null, 2));
    console.log('🔍 Debug - Campos obrigatórios:', ['chassi', 'cnpj', 'razaoSocial', 'nomeFantasia', 'enderecoCompleto']);
    const missing = ['chassi', 'cnpj', 'razaoSocial', 'nomeFantasia', 'enderecoCompleto'].filter(f => !bestData[f]);
    console.log('🔍 Debug - Campos ausentes:', missing);
  }

  console.error('Falha ao obter dados completos da ANTT.', lastError || 'Sem erro capturado');
  return bestData;
}

async function fetchWithPuppeteer(placa, { headless = 'new' } = {}) {
  // Usa puppeteer-extra com plugin stealth, com perfil persistente e suporte a proxy
  const userDataDir = process.env.PUPPETEER_USER_DATA_DIR || path.resolve(process.cwd(), '.puppeteer_data');
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--lang=pt-BR',
    '--disable-gpu',
    '--window-size=1366,768'
  ];
  const proxyUrl = process.env.PROXY_URL;
  if (proxyUrl) {
    args.push(`--proxy-server=${proxyUrl}`);
  }
  const browser = await puppeteerExtra.launch({
    headless,
    userDataDir,
    args
  });
  try {
    const page = await browser.newPage();
    // Autenticação de proxy (se houver credenciais em PROXY_URL)
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        if (u.username || u.password) {
          await page.authenticate({
            username: decodeURIComponent(u.username || ''),
            password: decodeURIComponent(u.password || '')
          });
        }
      } catch {}
    }
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(COMMON_HEADERS['User-Agent']);
    await page.setExtraHTTPHeaders({
      'Accept-Language': COMMON_HEADERS['Accept-Language']
    });
    // Intercepta requisições para bloquear analytics/imagens/fontes
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (/google-analytics|gtag|doubleclick|hotjar|facebook/gi.test(url)) {
        return req.abort();
      }
      if (['image', 'media', 'font'].includes(req.resourceType())) {
        return req.abort();
      }
      req.continue();
    });
    // Carrega a página de busca e tenta submeter o formulário
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle0' });
    try {
      await page.waitForSelector('input[name="txtPlaca"]', { timeout: 3000 });
      await page.type('input[name="txtPlaca"]', placa, { delay: 60 });
      const btn = await page.$('input[name="cmdConsultaPlaca"]');
      if (btn) {
        await btn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
      } else {
        // Fallback: tenta outros seletores
        const submitBtn = await page.$('input[type="submit"], button[type="submit"], input[value="Consultar"]');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        } else {
          await page.keyboard.press('Enter');
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
        }
      }
    } catch {
      // Fallback: acesso direto
      await page.goto(`${RESULT_URL}?txtPlaca=${encodeURIComponent(placa)}`, { waitUntil: 'networkidle0' });
    }

    // Extrai os dados: lida com páginas que usam frames/iframes// Aguarda a página carregar
  await page.waitForSelector('body');
  
  // Verifica se há erro 500 ou outros erros do servidor
  const hasServerError = await page.evaluate(() => {
    const title = document.title || '';
    const bodyText = document.body ? document.body.textContent : '';
    return title.includes('500') || 
           title.includes('Internal server error') ||
           bodyText.includes('500 - Internal server error') ||
           bodyText.includes('Server Error') ||
           bodyText.includes('There is a problem with the resource');
  });
  
  if (hasServerError) {
    if (process.env.DEBUG_SCRAPER) {
      console.log('❌ Site da ANTT retornou erro 500 (Internal Server Error)');
    }
    throw new Error('ANTT_SERVER_ERROR_500');
  }
  
  await page.waitForFunction(() => Array.from(document.querySelectorAll('th')).some(th => th.textContent && th.textContent.includes('Dados do Veículo')), { timeout: 8000 }).catch(() => {});
    const targetFrame = page.frames().find((f) => {
      const u = f.url() || '';
      return /conLocalizaVeiculo|mostraVeiculo|resultado/gi.test(u);
    }) || page.mainFrame();

    const data = await targetFrame.evaluate(() => {
      function sanitize(t) { return t ? t.replace(/\s+/g, ' ').trim() : null; }
      function getLabelValue(label) {
        const tds = Array.from(document.querySelectorAll('td'));
        const td = tds.find((x) => x.textContent && x.textContent.toLowerCase().includes(label.toLowerCase()));
        if (!td) return null;
        const next = td.nextElementSibling;
        if (next) return sanitize(next.textContent);
        const parent = td.parentElement;
        if (parent) {
          const cells = parent.querySelectorAll('td');
          if (cells[1]) return sanitize(cells[1].textContent);
        }
        return null;
      }
      const chassi = getLabelValue('Chassi/Motor');
      const cnpj = getLabelValue('CNPJ');
      const razaoSocial = getLabelValue('Razão Social') || getLabelValue('Razao Social');
      const nomeFantasia = getLabelValue('Nome Fantasia');
      const endereco = getLabelValue('Endereço') || getLabelValue('Endereco');
      const bairro = getLabelValue('Bairro');
      const cidade = getLabelValue('Cidade');
      const paisOrigem = getLabelValue('País de Origem') || getLabelValue('Pais de Origem');
      const enderecoCompleto = [endereco, bairro, cidade, paisOrigem].filter(Boolean).join(', ');
      return { chassi, cnpj, razaoSocial, nomeFantasia, enderecoCompleto };
    });
    // Fallback: parse do HTML renderizado
    const html = await page.content();
    const $ = load(html || '');
    function s(x){ return x ? x.replace(/\s+/g,' ').trim() : null; }
    const chassiF = (function(){ const td = $('td:contains("Chassi/Motor")').first(); const next = td.next('td'); return s(next.text()); })();
    const cnpjF = (function(){ const td = $('td:contains("CNPJ"), td:contains("CPNJ")').first(); const next = td.next('td'); return s(next.text()); })();
    const razaoF = (function(){ const td = $('td:contains("Razão Social"), td:contains("Razao Social")').first(); const next = td.next('td'); return s(next.text()); })();
    const fantasiaF = (function(){ const td = $('td:contains("Nome Fantasia")').first(); const next = td.next('td'); return s(next.text()); })();
    const enderecoF = (function(){ const td = $('td:contains("Endereço"), td:contains("Endereco")').first(); const next = td.next('td'); return s(next.text()); })();
    const bairroF = (function(){ const td = $('td:contains("Bairro")').first(); const next = td.next('td'); return s(next.text()); })();
    const cidadeF = (function(){ const td = $('td:contains("Cidade")').first(); const next = td.next('td'); return s(next.text()); })();
    const paisF = (function(){ const td = $('td:contains("País de Origem"), td:contains("Pais de Origem")').first(); const next = td.next('td'); return s(next.text()); })();
    const enderecoCompletoF = [enderecoF, bairroF, cidadeF, paisF].filter(Boolean).join(', ');
    const anyData = data && (data.chassi || data.cnpj || data.razaoSocial || data.nomeFantasia || data.enderecoCompleto);
    const anyFallback = chassiF || cnpjF || razaoF || fantasiaF || enderecoCompletoF;
    return anyData ? data : (anyFallback ? { chassi: chassiF, cnpj: cnpjF, razaoSocial: razaoF, nomeFantasia: fantasiaF, enderecoCompleto: enderecoCompletoF } : data);
  } finally {
    await browser.close();
  }
}