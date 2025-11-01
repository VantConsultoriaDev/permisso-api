# API de Consulta ANTT (Contrato de Frete)

Esta API consulta a página pública da ANTT (`https://scff.antt.gov.br/conPlaca.asp`) para obter dados do veículo e da empresa a partir da placa. Os campos retornados são exatamente os solicitados para preencher o SaaS:

- `chassi`
- `cnpj`
- `razaoSocial`
- `nomeFantasia`
- `endereco` (concatenação de Endereço + Bairro + Cidade + País de Origem)

## Como executar

1. Instale as dependências:
   - `npm install`
2. Execute o servidor:
   - `npm run start`
3. Verifique saúde:
   - `http://localhost:3000/health`

## Endpoint

- Método: `GET`
- URL: `http://localhost:3000/api/antt-veiculo?placa=ABC1D23`
- Parâmetros:
  - `placa`: string, somente letras e números (maiúsculas/minúsculas aceitas)

### Exemplo de resposta

```json
{
  "placa": "ABC1D23",
  "chassi": "93ZM1PNH0A8600394",
  "cnpj": "10.809.792/0001-01",
  "razaoSocial": "GRT TRANSPORTE E LOGÍSTICA LTDA.",
  "nomeFantasia": "GRT LOG",
  "endereco": "RUA SANTOS DUMONT N° 695, CIDADE ALEGRIA, URUGUAIANA-RS, BRASIL",
  "fonte": "https://scff.antt.gov.br/conPlaca.asp"
}
```

Observação: o scraper utiliza cabeçalhos e cookies de sessão para contornar restrições da página. Caso a ANTT mude o HTML ou a política de acesso, os seletores podem precisar de ajustes.