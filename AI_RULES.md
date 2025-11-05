# AI Editor Guidelines (Dyad Rules)

Este documento descreve a pilha tecnológica e as regras específicas de uso de bibliotecas para a manutenção e extensão desta aplicação Node.js.

## Visão Geral da Pilha Tecnológica (Tech Stack)

*   **Plataforma:** Node.js (utilizando ES Modules, conforme `package.json`).
*   **Servidor/Framework:** Express.js para roteamento e gerenciamento da API.
*   **Linguagem Principal:** JavaScript.
*   **Motor de Scraping:** Puppeteer (via `puppeteer-extra` e `puppeteer-extra-plugin-stealth`) para automação de navegador e contorno de restrições.
*   **Parsing de HTML:** Cheerio para análise eficiente de strings HTML e extração de dados usando seletores.
*   **Requisições HTTP:** Uso da API nativa `fetch` do Node.js para requisições HTTP simples.
*   **Estrutura de Código:** Lógica do servidor em `src/server.js` e lógica de scraping em `src/scraper/antt.js`.

## Regras de Uso de Bibliotecas

| Tarefa | Biblioteca Recomendada | Racional |
| :--- | :--- | :--- |
| **Roteamento e Servidor** | `express` | Padrão para definir endpoints e gerenciar o servidor API. |
| **Automação de Navegador** | `puppeteer-extra` + `puppeteer-extra-plugin-stealth` | Essencial para interagir com a página da ANTT, que pode exigir renderização JavaScript e técnicas anti-bot. |
| **Parsing de HTML Estático** | `cheerio` | Usado para extrair dados de strings HTML de forma rápida e eficiente após a obtenção do conteúdo (seja via `fetch` ou Puppeteer). |
| **Requisições HTTP Simples** | Native `fetch` | Deve ser usado para requisições que não exigem um navegador completo (ex: obter cookies iniciais). |
| **Manipulação de Arquivos/Paths** | Módulos nativos (`fs`, `path`) | Padrão do Node.js para operações de sistema de arquivos e resolução de caminhos. |