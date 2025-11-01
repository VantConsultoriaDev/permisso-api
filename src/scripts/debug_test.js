import { fetchAnttByPlate } from '../scraper/antt.js';

const placa = process.argv[2] || 'IGX3807';

console.log(`🔍 Testando extração de dados para a placa: ${placa}`);
console.log('=' .repeat(50));

// Configurar para modo debug
process.env.RETRY_STRICT = 'false';
process.env.RETRY_MAX_ATTEMPTS = '3';
process.env.RETRY_TOTAL_TIMEOUT_MS = '30000';

try {
  const result = await fetchAnttByPlate(placa);
  
  console.log('📊 Resultado completo:');
  console.log(JSON.stringify(result, null, 2));
  
  console.log('\n🔍 Análise dos campos:');
  console.log(`- Placa: ${result.placa || 'AUSENTE'}`);
  console.log(`- Chassi: ${result.chassi || 'AUSENTE'}`);
  console.log(`- CNPJ: ${result.cnpj || 'AUSENTE'}`);
  console.log(`- Razão Social: ${result.razaoSocial || 'AUSENTE'}`);
  console.log(`- Nome Fantasia: ${result.nomeFantasia || 'AUSENTE'}`);
  console.log(`- Endereço Completo: ${result.enderecoCompleto || 'AUSENTE'}`);
  
  // Verificar se todos os campos obrigatórios estão presentes
  const requiredFields = ['chassi', 'cnpj', 'razaoSocial', 'nomeFantasia', 'enderecoCompleto'];
  const missingFields = requiredFields.filter(field => !result[field] || String(result[field]).trim().length === 0);
  
  console.log('\n✅ Status dos campos obrigatórios:');
  if (missingFields.length === 0) {
    console.log('✅ TODOS os campos obrigatórios estão presentes!');
  } else {
    console.log(`❌ Campos ausentes: ${missingFields.join(', ')}`);
    console.log(`📊 Campos presentes: ${requiredFields.filter(f => !missingFields.includes(f)).join(', ')}`);
  }
  
} catch (error) {
  console.error('❌ Erro durante o teste:', error.message);
}