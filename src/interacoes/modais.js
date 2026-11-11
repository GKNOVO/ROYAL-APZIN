'use strict';

/** Modais: regra da partida e ID/senha da sala. */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ActivityType,
} = require('discord.js');
const config = require('../config');
const partidas = require('../servicos/partidas');
const fluxo = require('../servicos/fluxo');
const { responderPrivado, responderErro, ehMediador, ehAdmin } = require('../util/seguranca');
const { embedSucesso } = require('../util/embeds');

async function abrirModalRegras(interaction, db, partidaId) {
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');
  const jogadores = partidas.jogadores(db, partidaId);
  if (!jogadores.some((linha) => linha.user_id === interaction.user.id)) {
    return responderErro(interaction, 'Só quem está jogando essa sala pode enviar a regra.');
  }

  const modal = new ModalBuilder()
    .setCustomId(`ap:modalregras:${partidaId}`)
    .setTitle('Regra da partida')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('regra')
          .setLabel('Escreva a regra combinada')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Ex: 1x1 mobile, sem emulador, gelo infinito, 3 quedas, quem fizer mais pontos vence.')
          .setMinLength(5)
          .setMaxLength(config.LIMITES.REGRAS)
          .setRequired(true),
      ),
    );

  return interaction.showModal(modal);
}

async function abrirModalSala(interaction, db, partidaId) {
  if (!ehMediador(interaction.member)) {
    return responderErro(interaction, 'Só o mediador pode liberar a criação da sala.');
  }
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');

  const modal = new ModalBuilder()
    .setCustomId(`ap:modalsala:${partidaId}`)
    .setTitle('Liberar sala')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sala_id')
          .setLabel('ID da sala')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 12345678')
          .setMaxLength(40)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sala_senha')
          .setLabel('Senha da sala (se tiver)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setRequired(false),
      ),
    );

  return interaction.showModal(modal);
}

/** Campos do painel /botperfil: o modal é montado a partir daqui. */
const CAMPOS_BOT = {
  nome: {
    id: 'modalbotnome',
    titulo: 'Nome do bot',
    label: 'Novo nome (2 a 32 caracteres)',
    placeholder: 'ORG Royal AP',
    min: 2,
    max: 32,
  },
  avatar: {
    id: 'modalbotavatar',
    titulo: 'Avatar do bot',
    label: 'Link direto da imagem (png, jpg ou gif)',
    placeholder: 'https://exemplo.com/foto.png',
    min: 10,
    max: 400,
  },
  descricao: {
    id: 'modalbotdescricao',
    titulo: 'Descrição do bot',
    label: 'Sobre mim / descrição (até 400 caracteres)',
    placeholder: 'A ORG Royal AP de filas e apostas de Free Fire.',
    style: TextInputStyle.Paragraph,
    min: 0,
    max: 400,
    required: false,
  },
  status: {
    id: 'modalbotstatus',
    titulo: 'Status do bot',
    label: 'Texto do status (até 128 caracteres)',
    placeholder: 'AP da ORG Royal AP',
    min: 1,
    max: 128,
  },
};

const CAMPO_POR_ID = new Map(Object.entries(CAMPOS_BOT).map(([campo, info]) => [info.id, campo]));

/** Abre o modal de um campo do perfil do bot (só ADM). */
async function abrirModalBotPerfil(interaction, campo) {
  const info = CAMPOS_BOT[String(campo)];
  if (!info) return responderErro(interaction, 'Opção inválida do painel do bot.');
  if (!ehAdmin(interaction.member)) return responderErro(interaction, 'Só ADMs podem mudar o perfil do bot.');

  const entrada = new TextInputBuilder()
    .setCustomId('valor')
    .setLabel(info.label)
    .setStyle(info.style ?? TextInputStyle.Short)
    .setMaxLength(info.max)
    .setRequired(info.required ?? true)
    .setPlaceholder(info.placeholder);
  if (info.min > 0) entrada.setMinLength(info.min);

  return interaction.showModal(
    new ModalBuilder()
      .setCustomId(`ap:${info.id}`)
      .setTitle(info.titulo)
      .addComponents(new ActionRowBuilder().addComponents(entrada)),
  );
}

/** Aplica o que o ADM escreveu no modal direto no perfil do bot. */
async function aplicarPerfilBot(interaction, client, tipo) {
  const campo = CAMPO_POR_ID.get(String(tipo));
  if (!campo) return false;
  if (!ehAdmin(interaction.member)) {
    await responderErro(interaction, 'Só ADMs podem mudar o perfil do bot.');
    return true;
  }
  if (!client?.user) {
    await responderErro(interaction, 'Sem conexão com o Discord agora. Tente de novo em instantes.');
    return true;
  }

  const valor = String(interaction.fields.getTextInputValue('valor') || '').trim();

  try {
    if (campo === 'nome') {
      if (valor.length < 2 || valor.length > 32) throw new Error('O nome precisa ter entre 2 e 32 caracteres.');
      await client.user.setUsername(valor);
      await responderPrivado(interaction, { embeds: [embedSucesso(`Nome do bot agora é **${valor}**.`)] });
      return true;
    }

    if (campo === 'avatar') {
      if (!/^https?:\/\/\S+$/i.test(valor)) throw new Error('Manda um link http(s) direto da imagem (png/jpg/gif).');
      await client.user.setAvatar(valor);
      await responderPrivado(interaction, { embeds: [embedSucesso('Avatar do bot atualizado.')] });
      return true;
    }

    if (campo === 'descricao') {
      if (typeof client.application?.edit !== 'function') {
        throw new Error('A API não liberou a descrição para este bot. Use o Developer Portal.');
      }
      await client.application.edit({ description: valor || null });
      await responderPrivado(interaction, { embeds: [embedSucesso('Descrição (sobre mim) do bot atualizada.')] });
      return true;
    }

    client.user.setPresence({ activities: [{ name: valor, type: ActivityType.Custom }], status: 'online' });
    await responderPrivado(interaction, { embeds: [embedSucesso(`Status do bot: **${valor}**.`)] });
    return true;
  } catch (erro) {
    console.error(`[modais] perfil do bot (${campo}):`, erro.message);
    await responderErro(interaction, erro.message);
    return true;
  }
}

async function handleModal(interaction, { db, client }) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const tipo = partes[1];
  const partidaId = partes[2];

  try {
    // Modais do /botperfil (nome, avatar, descrição e status do bot).
    if (String(tipo || '').startsWith('modalbot')) return await aplicarPerfilBot(interaction, client, tipo);

    if (tipo === 'modalregras') {
      const texto = interaction.fields.getTextInputValue('regra');
      partidas.definirRegras(db, partidaId, texto, interaction.user.id);
      await fluxo.atualizarPartida(client, db, partidaId);
      await responderPrivado(interaction, {
        embeds: [embedSucesso('Regra registrada na sala! Agora todos clicam em **Confirmar Partida**.')],
      });
      return true;
    }

    if (tipo === 'modalsala') {
      if (!ehMediador(interaction.member)) {
        await responderErro(interaction, 'Só o mediador pode liberar a sala.');
        return true;
      }
      const salaId = interaction.fields.getTextInputValue('sala_id');
      const senha = interaction.fields.getTextInputValue('sala_senha');
      partidas.liberarSala(db, partidaId, { salaId, senha });
      await fluxo.atualizarPartida(client, db, partidaId);
      await responderPrivado(interaction, {
        embeds: [embedSucesso(`Sala liberada para os jogadores: ID \`${salaId}\`${senha ? ` · Senha \`${senha}\`` : ''}.`)],
      });
      return true;
    }

    return false;
  } catch (erro) {
    console.error(`[modais] erro em ${interaction.customId}:`, erro);
    await responderErro(interaction, erro.message || 'Deu um erro aqui. Tente de novo.');
    return true;
  }
}

module.exports = { abrirModalRegras, abrirModalSala, abrirModalBotPerfil, CAMPOS_BOT, handleModal };
