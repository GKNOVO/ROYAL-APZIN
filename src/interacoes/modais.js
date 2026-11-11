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
const staff = require('../servicos/staff');
const mediadores = require('../servicos/mediadores');
const fluxo = require('../servicos/fluxo');
const {
  responderPrivado,
  responderErro,
  ehMediador,
  ehAdmin,
  ehMediadorDaPartida,
} = require('../util/seguranca');
const validacao = require('../util/validacao');
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
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');
  if (!ehMediadorDaPartida(partida, interaction.member, interaction.user?.id)) {
    return responderErro(interaction, 'Só o mediador responsável por essa sala pode liberar a criação.');
  }
  if (partida.status !== 'pago') {
    return responderErro(interaction, 'A sala só é liberada depois do pagamento confirmado.');
  }

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

/**
 * Modal do PIX individual do mediador (chave, nome completo e cidade).
 *
 * CUIDADO: o Discord limita label/título a 45 caracteres (o erro aparece como
 * "Invalid string length"). Por isso os textos abaixo são curtos e os limites
 * de cada campo ficam bem abaixo do máximo permitido (4000).
 */
async function abrirModalPix(interaction) {
  try {
    const modal = new ModalBuilder()
      .setCustomId('ap:modalpix')
      .setTitle('Registrar PIX de mediador')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('chave')
            .setLabel('Chave PIX (CPF, e-mail, telefone, aleat.)')
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(200)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('titular')
            .setLabel('Nome completo do titular')
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(120)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('cidade')
            .setLabel('Cidade de registro da conta')
            .setStyle(TextInputStyle.Short)
            .setMinLength(2)
            .setMaxLength(80)
            .setRequired(true),
        ),
      );

    return await interaction.showModal(modal);
  } catch (erro) {
    console.error('[modais] não consegui abrir o cadastro PIX:', erro.message);
    return responderErro(interaction, 'Não consegui abrir o cadastro PIX agora. Tente de novo em instantes.');
  }
}

async function aplicarPix(interaction, db) {
  if (!mediadores.ehMediador(db, interaction.guildId, interaction.member)) {
    await responderErro(interaction, 'Só mediadores/ADM registram PIX de recebimento.');
    return true;
  }

  try {
    // Normaliza e valida cada campo antes de gravar (nada de string gigante).
    const chave = validacao.chavePix(interaction.fields.getTextInputValue('chave'));
    const titular = validacao.exigirTexto(interaction.fields.getTextInputValue('titular'), {
      campo: 'Titular',
      min: 3,
      max: 120,
    });
    const cidade = validacao.exigirTexto(interaction.fields.getTextInputValue('cidade'), {
      campo: 'Cidade',
      min: 2,
      max: 80,
    });

    const registro = staff.registrarPix(db, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      chave,
      titular,
      cidade,
    });

    await responderPrivado(interaction, {
      embeds: [
        embedSucesso(
          `PIX salvo! ✅\n**Chave:** \`${registro.pix_chave}\`\n**Titular:** ${registro.pix_titular || '—'}\n` +
            `**Cidade:** ${registro.pix_cidade || '—'}\n\n_Ao assumir uma sala, é essa chave que vai para os jogadores._`,
        ),
      ],
    });
  } catch (erro) {
    await responderErro(interaction, erro.message);
  }
  return true;
}

async function handleModal(interaction, { db, client }) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const tipo = partes[1];
  const partidaId = partes[2];

  try {
    // Modais do /botperfil (nome, avatar, descrição e status do bot).
    if (String(tipo || '').startsWith('modalbot')) return await aplicarPerfilBot(interaction, client, tipo);
    if (tipo === 'modalpix') return await aplicarPix(interaction, db);

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
      const partidaSala = partidas.buscar(db, partidaId);
      if (!partidaSala) {
        await responderErro(interaction, 'Sala não encontrada.');
        return true;
      }
      if (!ehMediadorDaPartida(partidaSala, interaction.member, interaction.user?.id)) {
        await responderErro(interaction, 'Só o mediador responsável por essa sala pode liberar.');
        return true;
      }
      const salaId = validacao.idSala(interaction.fields.getTextInputValue('sala_id'));
      const senha = validacao.senhaSala(interaction.fields.getTextInputValue('sala_senha'));
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
    require('../util/logs').registrarErro(`modal:${interaction.customId}`, erro, {
      guildId: interaction.guildId ?? null,
      canalId: interaction.channelId ?? null,
    });
    await responderErro(interaction, erro.message || 'Deu um erro aqui. Tente de novo.');
    return true;
  }
}

module.exports = {
  abrirModalRegras,
  abrirModalSala,
  abrirModalBotPerfil,
  abrirModalPix,
  CAMPOS_BOT,
  handleModal,
};
