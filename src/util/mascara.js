'use strict';

/**
 * Mascaramento de dados sensíveis (PIX, e-mail, telefone) para auditoria/logs.
 * Nada de chave completa em arquivo de log ou canal de auditoria.
 */

const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const TELEFONE = /(\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g;
const CARTAO = /\b(?:\d[ -]?){13,19}\b/g;

/** Mostra só o suficiente para a staff reconhecer a chave, nunca ela inteira. */
function mascararChave(valor) {
  const chave = String(valor ?? '').trim();
  if (!chave) return '—';

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(chave)) {
    const [nome, dominio] = chave.split('@');
    return `${nome.slice(0, 1)}***@${dominio}`;
  }
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(chave)) return '***.***.***-**';
  if (/^\+?\d{10,13}$/.test(chave.replace(/[\s()-]/g, ''))) return '(**) *****-****';
  if (chave.length <= 4) return '*'.repeat(chave.length);
  return `${'*'.repeat(Math.min(6, chave.length - 4))}${chave.slice(-4)}`;
}

/** Mascara PIX/e-mail/telefone/cartão dentro de um texto livre (auditoria). */
function mascararTexto(valor) {
  const texto = String(valor ?? '');
  if (!texto) return texto;
  return texto
    .replace(EMAIL, (original, inicial, dominio) => `${inicial}***@${dominio}`)
    .replace(CPF, '***.***.***-**')
    .replace(CARTAO, '**** **** **** ****')
    .replace(TELEFONE, '(**) *****-****');
}

module.exports = { mascararChave, mascararTexto };
