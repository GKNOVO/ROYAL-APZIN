'use strict';

/**
 * Validação e normalização de TUDO que vem de fora (modal, comando, botão).
 *
 * O banco sempre usa consultas preparadas (sem injeção de SQL), mas texto
 * enorme, caractere de controle ou ID inventado quebra embed, log e regra de
 * negócio. Aqui cada campo é limpo e limitado antes de chegar no serviço.
 */

/** Remove controles, colapsa espaços e corta no tamanho máximo. */
function limpar(valor, max = 200) {
  return String(valor ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, Math.trunc(max)));
}

function exigirTexto(valor, { campo = 'Texto', min = 1, max = 200 } = {}) {
  const texto = limpar(valor, max);
  if (texto.length < min) {
    throw new Error(`${campo} precisa ter pelo menos ${min} caractere(s).`);
  }
  return texto;
}

/** IDs do Discord têm 17 a 20 dígitos. */
function idDiscord(valor, campo = 'ID') {
  const id = limpar(valor, 32);
  if (!/^\d{17,20}$/.test(id)) throw new Error(`${campo} inválido.`);
  return id;
}

/** ID/senha de sala do jogo: nada de espaço, emoji ou texto gigante. */
function idSala(valor) {
  const id = limpar(valor, 40);
  if (!id) throw new Error('Informe o ID da sala.');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new Error('O ID da sala aceita apenas letras, números, `_` e `-` (até 40 caracteres).');
  }
  return id;
}

function senhaSala(valor) {
  if (valor === null || valor === undefined) return null;
  const senha = limpar(valor, 40);
  if (!senha) return null;
  if (!/^[\w!@#$%&*.-]{1,40}$/.test(senha)) {
    throw new Error('A senha da sala tem caractere inválido (use letras, números ou `!@#$%&*.-`).');
  }
  return senha;
}

/** Chave PIX: aceita CPF, CNPJ, e-mail, telefone e chave aleatória. */
function chavePix(valor) {
  const chave = limpar(valor, 200);
  if (chave.length < 3) throw new Error('A chave PIX precisa ter pelo menos 3 caracteres.');
  if (!/^[\w.@+\-/=: ]{3,200}$/.test(chave)) {
    throw new Error('A chave PIX tem caractere inválido. Confira e tente de novo.');
  }
  return chave;
}

function urlHttp(valor, { campo = 'Link', max = 400 } = {}) {
  const url = limpar(valor, max);
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`${campo} precisa começar com http:// ou https://.`);
  return url;
}

function inteiro(valor, { campo = 'Número', min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero) || numero < min || numero > max) {
    throw new Error(`${campo} inválido (use um número entre ${min} e ${max}).`);
  }
  return numero;
}

module.exports = {
  limpar,
  exigirTexto,
  idDiscord,
  idSala,
  senhaSala,
  chavePix,
  urlHttp,
  inteiro,
};
