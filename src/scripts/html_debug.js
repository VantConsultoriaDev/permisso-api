import puppeteer from 'puppeteer';
import fs from 'fs';

const placa = process.argv[2] || 'IGX3807';
const SEARCH_URL = 'https://scff.antt.gov.br/conPlaca.asp';
const RESULT_URL = 'https://scff.antt.gov.br/conLocalizaVeiculo.asp';

console.log(`🔍 Capturando HTML da página para a placa: ${placa}`);

const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
  
  // Carrega a página de busca
  console.log('📄 Carregando página de busca...');
  await page.goto(SEARCH_URL, { waitUntil: 'networkidle0' });
  
  try {
    // Preenche o formulário
    console.log('✏️ Preenchendo formulário...');
    await page.waitForSelector('input[name="txtPlaca"]', { timeout: 3000 });
    await page.type('input[name="txtPlaca"]', placa, { delay: 60 });
    
    // Submete o formulário
    console.log('🚀 Submetendo formulário...');
    const btn = await page.$('input[type="submit"], button[type="submit"], input[value="Consultar"]');
    if (btn) {
      await btn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    } else {
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
    }
  } catch {
    // Fallback: acesso direto
    console.log('🔄 Fallback: acesso direto...');
    await page.goto(`${RESULT_URL}?placa=${encodeURIComponent(placa)}`, { waitUntil: 'networkidle0' });
  }

  // Aguarda a página carregar
  console.log('⏳ Aguardando página carregar...');
  await page.waitForSelector('body');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('th')).some(th => th.textContent && th.textContent.includes('Dados do Veículo')), { timeout: 8000 }).catch(() => {});
  
  // Captura o HTML
  console.log('📋 Capturando HTML...');
  const html = await page.content();
  
  // Salva o HTML em arquivo
  const filename = `debug_html_${placa}_${Date.now()}.html`;
  fs.writeFileSync(filename, html);
  console.log(`💾 HTML salvo em: ${filename}`);
  
  // Analisa a estrutura das tabelas
  console.log('\n🔍 Analisando estrutura das tabelas...');
  const tableInfo = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((table, index) => {
      const rows = Array.from(table.querySelectorAll('tr'));
      const cells = Array.from(table.querySelectorAll('td, th'));
      const textContent = table.textContent.replace(/\s+/g, ' ').trim().substring(0, 200);
      return {
        index,
        rowCount: rows.length,
        cellCount: cells.length,
        preview: textContent
      };
    });
  });
  
  console.log('📊 Tabelas encontradas:');
  tableInfo.forEach(info => {
    console.log(`  Tabela ${info.index}: ${info.rowCount} linhas, ${info.cellCount} células`);
    console.log(`    Preview: ${info.preview}...`);
  });
  
  // Procura por células específicas
  console.log('\n🔍 Procurando por campos específicos...');
  const fieldSearch = await page.evaluate(() => {
    const fields = ['Chassi/Motor', 'CNPJ', 'Razão Social', 'Nome Fantasia', 'Endereço', 'Bairro', 'Cidade'];
    const results = {};
    
    fields.forEach(field => {
      const tds = Array.from(document.querySelectorAll('td, th'));
      const found = tds.find(td => td.textContent && td.textContent.toLowerCase().includes(field.toLowerCase()));
      if (found) {
        const next = found.nextElementSibling;
        results[field] = {
          found: true,
          text: found.textContent.trim(),
          nextText: next ? next.textContent.trim() : 'N/A'
        };
      } else {
        results[field] = { found: false };
      }
    });
    
    return results;
  });
  
  console.log('🔍 Resultados da busca por campos:');
  Object.entries(fieldSearch).forEach(([field, result]) => {
    if (result.found) {
      console.log(`  ✅ ${field}: "${result.text}" -> "${result.nextText}"`);
    } else {
      console.log(`  ❌ ${field}: não encontrado`);
    }
  });
  
} finally {
  await browser.close();
}