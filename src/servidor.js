'use strict';

/**
 * Servidor HTTP mínimo ("health check").
 *
 * Bots de Discord não abrem porta nenhuma, e o Render — que hospeda Web Services —
 * derruba quem não responde em uma porta. Este servidor roda junto com o bot,
 * escuta na porta que o ambiente mandar (process.env.PORT) e responde 200
 * em qualquer requisição. Não interfere em nada do Discord.
 */

const http = require('http');

const TEXTO = 'Bot Royal AP Online e Operante!';

function corpoResposta() {
  return `${TEXTO}\nAtivo desde ${new Date().toISOString()}\n`;
}

function criarServidor() {
  return http.createServer((req, res) => {
    const corpo = corpoResposta();
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(corpo),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : corpo);
  });
}

/**
 * Sobe o servidor em paralelo ao bot.
 * Se a porta estiver ocupada, só avisa: o bot continua funcionando no Discord.
 */
function iniciarServidor(porta = Number(process.env.PORT) || 3000) {
  const servidor = criarServidor();

  servidor.on('error', (erro) => {
    console.error(`⚠️  Servidor HTTP não subiu na porta ${porta}: ${erro.message}`);
    console.error('   O bot continua rodando normalmente no Discord.');
  });

  servidor.listen(porta, '0.0.0.0', () => {
    console.log(`🌐 Servidor HTTP de saúde aberto na porta ${porta} (Render/Docker ok)`);
  });

  return servidor;
}

module.exports = { TEXTO, criarServidor, iniciarServidor };
