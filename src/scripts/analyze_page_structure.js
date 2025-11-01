import puppeteer from 'puppeteer';
import fs from 'fs';

async function analyzePageStructure() {
  console.log('🔍 Analisando estrutura da página da ANTT...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=pt-BR'
    ]
  });

  try {
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
    
    console.log('📄 Acessando página de busca...');
    await page.goto('https://scff.antt.gov.br/conPlaca.asp', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Analisa a estrutura da página
    const pageAnalysis = await page.evaluate(() => {
      // Busca todos os inputs
      const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        value: input.value,
        placeholder: input.placeholder,
        outerHTML: input.outerHTML
      }));
      
      // Busca todos os forms
      const forms = Array.from(document.querySelectorAll('form')).map(form => ({
        action: form.action,
        method: form.method,
        name: form.name,
        id: form.id,
        innerHTML: form.innerHTML.substring(0, 500) // Primeiros 500 chars
      }));
      
      // Busca por texto relacionado a placa
      const bodyText = document.body.textContent;
      const placaMatches = bodyText.match(/placa/gi) || [];
      
      return {
        title: document.title,
        inputs,
        forms,
        placaMatches: placaMatches.length,
        bodyLength: bodyText.length,
        url: window.location.href
      };
    });
    
    console.log('📋 Análise da página:');
    console.log('Título:', pageAnalysis.title);
    console.log('URL:', pageAnalysis.url);
    console.log('Tamanho do body:', pageAnalysis.bodyLength);
    console.log('Menções a "placa":', pageAnalysis.placaMatches);
    
    console.log('\n📝 Formulários encontrados:');
    pageAnalysis.forms.forEach((form, index) => {
      console.log(`Form ${index + 1}:`, {
        action: form.action,
        method: form.method,
        name: form.name,
        id: form.id
      });
    });
    
    console.log('\n🔍 Inputs encontrados:');
    pageAnalysis.inputs.forEach((input, index) => {
      console.log(`Input ${index + 1}:`, input);
    });
    
    // Salva o HTML completo para análise
    const html = await page.content();
    const filename = `page_structure_${Date.now()}.html`;
    fs.writeFileSync(filename, html);
    console.log(`\n💾 HTML completo salvo em: ${filename}`);
    
    return pageAnalysis;
    
  } catch (error) {
    console.error('❌ Erro durante a análise:', error.message);
    return null;
  } finally {
    await browser.close();
  }
}

analyzePageStructure()
  .then(result => {
    console.log('\n🏁 Análise concluída');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
  });