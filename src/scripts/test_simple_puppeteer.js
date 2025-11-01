import puppeteer from 'puppeteer';

async function testSimplePuppeteer(placa) {
  console.log(`🔍 Testando acesso simples ao ANTT com placa: ${placa}`);
  
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
    
    // Configurações básicas sem interceptação
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');
    
    console.log('📄 Acessando página de busca...');
    await page.goto('https://scff.antt.gov.br/conPlaca.asp', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Verifica se a página carregou corretamente
    const title = await page.title();
    console.log(`📋 Título da página: ${title}`);
    
    // Verifica se há erro 500
    const hasError = await page.evaluate(() => {
      const title = document.title || '';
      const bodyText = document.body ? document.body.textContent : '';
      return {
        title,
        hasServerError: title.includes('500') || 
                       title.includes('Internal server error') ||
                       bodyText.includes('500 - Internal server error') ||
                       bodyText.includes('Server Error'),
        bodyLength: bodyText.length
      };
    });
    
    console.log('🔍 Verificação de erro:', hasError);
    
    if (hasError.hasServerError) {
      console.log('❌ Erro 500 detectado na página inicial');
      return null;
    }
    
    // Tenta encontrar o campo de placa
    const inputExists = await page.$('input[name="placa"]');
    console.log(`🔍 Campo de placa encontrado: ${inputExists ? 'Sim' : 'Não'}`);
    
    if (inputExists) {
      console.log('✏️ Preenchendo placa...');
      await page.type('input[name="placa"]', placa, { delay: 100 });
      
      // Tenta submeter o formulário
      console.log('🚀 Submetendo formulário...');
      const submitButton = await page.$('input[type="submit"], button[type="submit"], input[value="Consultar"]');
      
      if (submitButton) {
        await submitButton.click();
        console.log('⏳ Aguardando navegação...');
        await page.waitForNavigation({ 
          waitUntil: 'networkidle0', 
          timeout: 15000 
        }).catch(() => console.log('⚠️ Timeout na navegação'));
      }
      
      // Verifica a página de resultado
      const resultTitle = await page.title();
      console.log(`📋 Título da página de resultado: ${resultTitle}`);
      
      const resultCheck = await page.evaluate(() => {
        const title = document.title || '';
        const bodyText = document.body ? document.body.textContent : '';
        return {
          title,
          hasServerError: title.includes('500') || 
                         title.includes('Internal server error') ||
                         bodyText.includes('500 - Internal server error') ||
                         bodyText.includes('Server Error'),
          bodyLength: bodyText.length,
          hasVehicleData: bodyText.includes('Dados do Veículo') || 
                         bodyText.includes('Chassi') ||
                         bodyText.includes('CNPJ'),
          url: window.location.href
        };
      });
      
      console.log('🔍 Verificação da página de resultado:', resultCheck);
      
      if (resultCheck.hasServerError) {
        console.log('❌ Erro 500 detectado na página de resultado');
        
        // Salva o HTML para análise
        const html = await page.content();
        const fs = await import('fs');
        const filename = `debug_simple_${placa}_${Date.now()}.html`;
        fs.writeFileSync(filename, html);
        console.log(`💾 HTML salvo em: ${filename}`);
        
        return null;
      }
      
      if (resultCheck.hasVehicleData) {
        console.log('✅ Dados do veículo encontrados na página!');
        return { success: true, data: resultCheck };
      } else {
        console.log('⚠️ Dados do veículo não encontrados');
        return { success: false, data: resultCheck };
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Erro durante o teste:', error.message);
    return null;
  } finally {
    await browser.close();
  }
}

// Testa com a placa fornecida
const placa = process.argv[2] || 'ISZ1E88';
testSimplePuppeteer(placa)
  .then(result => {
    console.log('🏁 Resultado final:', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
  });