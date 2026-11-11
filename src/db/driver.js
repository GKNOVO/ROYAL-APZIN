'use strict';

/**
 * Motor do banco: usa o SQLite embutido do Node (node:sqlite, Node 22.13+)
 * e, se existir, o better-sqlite3 (mais rápido e compatível com Node 20).
 *
 * Os dois motores recebem aqui a mesma interface: prepare, exec, pragma,
 * transaction (com savepoints para transações aninhadas) e close.
 */

const fs = require('fs');
const path = require('path');

/** Envolve o DatabaseSync do node:sqlite para ficar igual ao better-sqlite3. */
function envolverNodeSqlite(bruto) {
  let nivel = 0;

  return {
    prepare: (sql) => bruto.prepare(sql),
    exec: (sql) => bruto.exec(sql),
    pragma: (sql) => bruto.exec(`PRAGMA ${sql}`),
    close: () => bruto.close(),
    /** Igual ao db.transaction() do better-sqlite3, com savepoint ao aninhar. */
    transaction(fn) {
      return (...args) => {
        const nivelAtual = nivel;
        const ponto = `sp_${nivelAtual}`;
        if (nivelAtual === 0) bruto.exec('BEGIN IMMEDIATE');
        else bruto.exec(`SAVEPOINT ${ponto}`);
        nivel += 1;

        try {
          const resultado = fn(...args);
          nivel -= 1;
          if (nivel === 0) bruto.exec('COMMIT');
          else bruto.exec(`RELEASE ${ponto}`);
          return resultado;
        } catch (erro) {
          nivel -= 1;
          try {
            if (nivel === 0) bruto.exec('ROLLBACK');
            else {
              bruto.exec(`ROLLBACK TO ${ponto}`);
              bruto.exec(`RELEASE ${ponto}`);
            }
          } catch {
            /* o erro original é mais útil */
          }
          throw erro;
        }
      };
    },
  };
}

function abrirMotor(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });

  // 1) better-sqlite3, se estiver instalado e compatível com este Node.
  try {
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const db = new Database(caminho);
    return { db, motor: 'better-sqlite3' };
  } catch (erroBetter) {
    // 2) SQLite embutido do Node.
    try {
      // eslint-disable-next-line global-require
      const { DatabaseSync } = require('node:sqlite');
      const db = envolverNodeSqlite(new DatabaseSync(caminho));
      return { db, motor: 'node:sqlite' };
    } catch (erroNode) {
      const detalhe = `${erroBetter.message} | ${erroNode.message}`;
      const erro = new Error(
        'Nenhum motor de SQLite disponível neste Node. Atualize o Node para 22.13 ou mais novo ' +
          '(nodejs.org) ou instale o better-sqlite3 com: npm install better-sqlite3. ' +
          `Detalhe: ${detalhe}`,
      );
      erro.detalhe = detalhe;
      throw erro;
    }
  }
}

module.exports = { abrirMotor };
