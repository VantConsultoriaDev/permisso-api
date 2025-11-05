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
    // Fallback: look for the second TD in the same row
    const fallback = parent.find('td').eq(1).text();
    if (fallback) return sanitize(fallback);
  }
  // Fallback: regex search across all text (less reliable)
  const bodyText = $('body').text();
  const re = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*([^\n\r]+)`, 'i');
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
    // Consider data complete if we have Chassi AND CNPJ/Razão Social
    const hasVehicle = d.chassi && String(d.chassi).trim().length > 0;
    const hasCompany = (d.cnpj && String(d.cnpj).trim().length > 0) || (d.razaoSocial && String(d.razaoSocial).trim().length > 0);
    return hasVehicle && hasCompany;
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
      
      // Check for "VEÍCULO NÃO CADASTRADO" message
      if ($('body').text().includes('VEÍCULO NÃO CADASTRADO NA ANTT!')) {
          return { chassi: null, cnpj: null, razaoSocial: null, nomeFantasia: null, enderecoCompleto: null };
      }
      
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

  async function attemptPuppeteer() {
    let browser;
    try {
      const data = await fetchWithPuppeteer(placa, { headless: 'new' });
      return data;
    } catch (err) {
      lastError = err;
      // Re-throw specific ANTT error to be handled by the retry loop
      if (err.message === 'ANTT_SERVER_ERROR_500') {
        throw err;
      }
      return null;
    }
  }

  const strategies = process.env.PROXY_URL ? [
    attemptPuppeteer,
    attemptHttp,
    attemptPuppeteer,
    attemptHttp,
  ] : [
    attemptHttp,
    attemptPuppeteer,
    attemptHttp,
    attemptPuppeteer,
  ];

  let bestData = { placa };
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() - start > TOTAL_TIMEOUT_MS && !STRICT) break;
    const strat = strategies[(attempt - 1) % strategies.length];
    
    try {
        const data = await strat();
        if (isCompleteData(data)) return { placa, ...data };
        
        // Coleta dados parciais se tiver mais campos que o melhor até agora
        if (data && Object.keys(data).length > Object.keys(bestData).length) {
          bestData = { placa, ...data };
        }
        
        // Se a placa não está cadastrada, retorna imediatamente
        if (data && !data.chassi && !data.cnpj && !data.razaoSocial) {
            return { placa, ...data };
        }
        
    } catch (e) {
        lastError = e;
        if (e.message === 'ANTT_SERVER_ERROR_500') {
            // Se for erro 500, espera um pouco mais e tenta novamente
            if (process.env.DEBUG_SCRAPER) {
                console.log('🚨 Site da ANTT indisponível (erro 500). Tentando novamente...');
            }
            await sleep(5000);
            continue; // Pula o delay normal e tenta novamente
        }
    }
    
    const base = 800;
    const delay = Math.min(8000, base * Math.pow(1.6, attempt - 1) + Math.floor(Math.random() * 900));
    await sleep(delay);
  }

  // If strict, keep trying until timeout cap is reached
  while (Date.now() - start <= TOTAL_TIMEOUT_MS && STRICT) {
    const strat = strategies[Math.floor(Math.random() * strategies.length)];
    
    try {
        const data = await strat();
        if (isCompleteData(data)) return { placa, ...data };
        
        if (data && Object.keys(data).length > Object.keys(bestData).length) {
          bestData = { placa, ...data };
        }
        
        if (data && !data.chassi && !data.cnpj && !data.razaoSocial) {
            return { placa, ...data };
        }
        
    } catch (e) {
        lastError = e;
        if (e.message === 'ANTT_SERVER_ERROR_500') {
            await sleep(5000);
            continue;
        }
    }
    
    await sleep(1500 + Math.floor(Math.random() * 1200));
  }

  // Log detalhado para debug
  if (process.env.DEBUG_SCRAPER === 'true') {
    console.log('🔍 Debug - Dados extraídos:', JSON.stringify(bestData, null, 2));
    console.log('🔍 Debug - Campos obrigatórios:', ['chassi', 'cnpj', 'razaoSocial', 'nomeFantasia', 'enderecoCompleto']);
    const missing = ['chassi', 'cnpj', 'razaoSocial', 'nomeFantasia', 'enderecoCompleto'].filter(f => !bestData[f]);
    console.log('🔍 Debug - Campos ausentes:', missing);
  }

  if (!isCompleteData(bestData) && lastError) {
      console.error('Falha ao obter dados completos da ANTT.', lastError.message || 'Sem erro capturado');
  }
  
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
  
  let browser;
  try {
    browser = await puppeteerExtra.launch({
      headless,
      userDataDir,
      args
    });
    
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
        // Espera pela navegação ou timeout
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
    } catch (e) {
      // Se falhar ao interagir com o formulário, tenta acesso direto
      if (process.env.DEBUG_SCRAPER) {
          console.log('⚠️ Falha na interação com o formulário. Tentando acesso direto...');
      }
      await page.goto(`${RESULT_URL}?txtPlaca=${encodeURIComponent(placa)}`, { waitUntil: 'networkidle0' });
    }

    // Aguarda a página carregar
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
    
    // Espera por algum indicador de dados (Dados do Veículo ou Aviso)
    await page.waitForFunction(() => Array.from(document.querySelectorAll('th, b')).some(el => el.textContent && (el.textContent.includes('Dados do Veículo') || el.textContent.includes('Situação: VEÍCULO NÃO CADASTRADO'))), { timeout: 8000 }).catch(() => {});

    // Extrai os dados
    const targetFrame = page.frames().find((f) => {
      const u = f.url() || '';
      return /conLocalizaVeiculo|mostraVeiculo|resultado/gi.test(u);
    }) || page.mainFrame();

    const data = await targetFrame.evaluate(() => {
      function sanitize(t) { return t ? t.replace(/\s+/g, ' ').trim() : null; }
      function getLabelValue(label) {
        const tds = Array.from(document.querySelectorAll('td'));
        // Busca a célula que contém o label (case insensitive)
        const td = tds.find((x) => x.textContent && x.textContent.toLowerCase().includes(label.toLowerCase()));
        if (!td) return null;
        
        // Tenta pegar o próximo elemento irmão (que deve ser o valor)
        const next = td.nextElementSibling;
        if (next) return sanitize(next.textContent);
        
        // Fallback: se o label estiver em negrito dentro de um TD, o valor pode estar no TD seguinte
        const parent = td.parentElement;
        if (parent) {
          const cells = parent.querySelectorAll('td');
          // Se a célula 0 contém o label, a célula 1 deve conter o valor
          if (cells[0] === td && cells[1]) return sanitize(cells[1].textContent);
        }
        return null;
      }
      
      // Verifica se é a página de "VEÍCULO NÃO CADASTRADO"
      if (document.body.textContent.includes('VEÍCULO NÃO CADASTRADO NA ANTT!')) {
          return { chassi: null, cnpj: null, razaoSocial: null, nomeFantasia: null, enderecoCompleto: null };
      }
      
      const chassi = getLabelValue('Chassi/Motor');
      const cnpj = getLabelValue('CNPJ') || getLabelValue('CPNJ');
      const razaoSocial = getLabelValue('Razão Social') || getLabelValue('Razao Social');
      const nomeFantasia = getLabelValue('Nome Fantasia');
      const endereco = getLabelValue('Endereço') || getLabelValue('Endereco');
      const bairro = getLabelValue('Bairro');
      const cidade = getLabelValue('Cidade');
      const paisOrigem = getLabelValue('País de Origem') || getLabelValue('Pais de Origem');
      const enderecoCompleto = [endereco, bairro, cidade, paisOrigem].filter(Boolean).join(', ');
      return { chassi, cnpj, razaoSocial, nomeFantasia, enderecoCompleto };
    });
    
    // Fallback: parse do HTML renderizado (Cheerio)
    const html = await page.content();
    const $ = load(html || '');
    function s(x){ return x ? x.replace(/\s+/g,' ').trim() : null; }
    
    // Verifica se o Puppeteer retornou dados válidos
    const anyData = data && (data.chassi || data.cnpj || data.razaoSocial || data.nomeFantasia || data.enderecoCompleto);
    
    if (anyData) {
        return data;
    }
    
    // Se o Puppeteer falhou na extração, tenta o Cheerio no HTML final
    const chassiF = (function(){ const td = $('td:contains("Chassi/Motor")').first(); const next = td.next('td'); return s(next.text()); })();
    const cnpjF = (function(){ const td = $('td:contains("CNPJ"), td:contains("CPNJ")').first(); const next = td.next('td'); return s(next.text()); })();
    const razaoF = (function(){ const td = $('td:contains("Razão Social"), td:contains("Razao Social")').first(); const next = td.next('td'); return s(next.text()); })();
    const fantasiaF = (function(){ const td = $('td:contains("Nome Fantasia")').first(); const next = td.next('td'); return s(next.text()); })();
    const enderecoF = (function(){ const td = $('td:contains("Endereço"), td:contains("Endereco")').first(); const next = td.next('td'); return s(next.text()); })();
    const bairroF = (function(){ const td = $('td:contains("Bairro")').first(); const next = td.next('td'); return s(next.text()); })();
    const cidadeF = (function(){ const td = $('td:contains("Cidade")').first(); const next = td.next('td'); return s(next.text()); })();
    const paisF = (function(){ const td = $('td:contains("País de Origem"), td:contains("Pais de Origem")').first(); const next = td.next('td'); return s(next.text()); })();
    const enderecoCompletoF = [enderecoF, bairroF, cidadeF, paisF].filter(Boolean).join(', ');
    
    const fallbackData = { chassi: chassiF, cnpj: cnpjF, razaoSocial: razaoF, nomeFantasia: fantasiaF, enderecoCompleto: enderecoCompletoF };
    
    // Se o fallback do Cheerio encontrar dados, usa eles.
    const anyFallback = fallbackData.chassi || fallbackData.cnpj || fallbackData.razaoSocial || fallbackData.nomeFantasia || fallbackData.enderecoCompleto;
    
    return anyFallback ? fallbackData : data;
    
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}