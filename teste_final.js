import { fetchAnttByPlate } from './src/scraper/antt.js';

async function testeFinal() {
  console.log('🧪 Teste Final - Placa JAB4D50\n');
  
  const placa = 'JAB4D50';
  
  console.log(`📋 Consultando placa: ${placa}`);
  console.log('⏳ Aguarde...\n');
  
  try {
    const resultado = await fetchAnttByPlate(placa);
    
    if (resultado) {
      console.log('✅ Dados extraídos com sucesso:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🚗 Placa: ${resultado.placa || placa}`);
      console.log(`🔧 Chassi: ${resultado.chassi || 'Não encontrado'}`);
      console.log(`🏢 CNPJ: ${resultado.cnpj || 'Não encontrado'}`);
      console.log(`🏛️ Razão Social: ${resultado.razaoSocial || 'Não encontrado'}`);
      console.log(`🏪 Nome Fantasia: ${resultado.nomeFantasia || 'Não encontrado'}`);
      console.log(`📍 Endereço: ${resultado.enderecoCompleto || 'Não encontrado'}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Verificação específica do CNPJ
      if (resultado.cnpj) {
        console.log('\n🎉 CNPJ extraído com sucesso! A correção funcionou.');
      } else {
        console.log('\n⚠️ CNPJ não encontrado. Pode ser que o veículo não tenha CNPJ cadastrado.');
      }
      
    } else {
      console.log('❌ Nenhum dado foi retornado. Possíveis causas:');
      console.log('   • Placa não cadastrada na ANTT');
      console.log('   • Erro de conexão');
      console.log('   • Site da ANTT indisponível');
    }
    
  } catch (error) {
    console.log('❌ Erro durante a consulta:', error.message);
  }
}

testeFinal().catch(console.error);