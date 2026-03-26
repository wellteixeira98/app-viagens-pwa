/* App Build: 20260326_1451 */

/* =================================================================
 * 🤖 TRADUTOR PWA + OPTIMISTIC UI AVANÇADO + CACHE DE FERRO
 * ================================================================= */
const API_URL = "https://script.google.com/macros/s/AKfycbw_L3HYd-LlpxKObn60If0lb20LG0jX7eZxxHrQYgrV/dev";
const SYNC_QUEUE_KEY = 'VIAGENS_MANUAL_QUEUE';

window.App_ModaisAbertos = [];
let tentouSair = false;
history.pushState({ telaPrincipal: true }, "");

window.App_AbrirTela = function(idModal, tipo = 'block') {
  const el = document.getElementById(idModal);
  if(el) {
    el.style.display = tipo;
    window.App_ModaisAbertos.push(idModal);
    history.pushState({ modalAtivo: idModal }, "");
  }
};

window.App_FecharTela = function(idModal) {
  const index = window.App_ModaisAbertos.indexOf(idModal);
  if (index !== -1) {
    history.back(); 
  } else {
    const el = document.getElementById(idModal);
    if(el) el.style.display = 'none';
  }
};

window.addEventListener('popstate', function(event) {
  if (typeof Swal !== 'undefined' && Swal.isVisible()) {
    Swal.close();
    history.pushState(event.state, ""); 
    return;
  }
  if (window.App_ModaisAbertos.length > 0) {
    const ultimoModal = window.App_ModaisAbertos.pop();
    const el = document.getElementById(ultimoModal);
    if (el) el.style.display = 'none';
    return;
  }
  if (!tentouSair) {
    tentouSair = true;
    history.pushState({ telaPrincipal: true }, ""); 
    if(typeof Swal !== 'undefined') {
      Swal.fire({
        title: 'Pressione voltar novamente para sair',
        toast: true, position: 'bottom', showConfirmButton: false, timer: 2000, background: '#333', color: '#fff'
      });
    }
    setTimeout(() => { tentouSair = false; }, 2000);
  }
});

// --- O CÉREBRO LOCAL: PROXY DE COMUNICAÇÃO (OFFLINE FIRST) ---
window.google = {
  script: {
    run: {
      withSuccessHandler: function(onSuccess) { this._onSuccess = onSuccess; return this; },
      withFailureHandler: function(onFailure) { this._onFailure = onFailure; return this; }
    }
  }
};

window.google.script.run = new Proxy(window.google.script.run, {
  get(target, prop) {
    // Evita falsos positivos com Promises nativas
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
    if (prop in target) return target[prop];

    return async function(...args) {
      const onSuccess = target._onSuccess;
      const onFailure = target._onFailure;
      target._onSuccess = null; target._onFailure = null;

      // 🧠 1. ESCRITA: Vai para a fila de sincronização manual
      if (typeof prop === 'string' && (prop.includes('salvar') || prop.includes('excluir') || prop.includes('Toggle'))) {
         let filaSync = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
         
         if (prop === 'Viagens_salvarRegistro') {
            let payload = args[0];
            let isNovo = !payload.ID || String(payload.ID).startsWith('temp_');
            
            if (isNovo && !payload.ID) payload.ID = 'temp_' + Date.now();
            
            if (window.ESTADO_APP && window.ESTADO_APP.dadosBD) {
               let idx = window.ESTADO_APP.dadosBD.findIndex(i => i.ID === payload.ID);
               if (idx > -1) window.ESTADO_APP.dadosBD[idx] = payload;
               else window.ESTADO_APP.dadosBD.push(payload);
               
               localStorage.setItem('DADOS_VIAGEM_CACHE', JSON.stringify(window.ESTADO_APP.dadosBD));
               if (typeof window.UI_renderizarInterface === 'function') window.UI_renderizarInterface();
            }

            if (isNovo) {
                let payloadBackend = JSON.parse(JSON.stringify(payload));
                payloadBackend.ID = ""; 
                filaSync.push({ funcao: prop, parametros: [payloadBackend, args[1]], id_local: payload.ID });
            } else if (String(payload.ID).startsWith('temp_')) {
                let itemFila = filaSync.find(i => i.id_local === payload.ID);
                if (itemFila) {
                    let payloadBackend = JSON.parse(JSON.stringify(payload));
                    payloadBackend.ID = "";
                    itemFila.parametros[0] = payloadBackend;
                }
            } else {
                filaSync.push({ funcao: prop, parametros: args, id_local: Date.now() });
            }
         }
         else if (prop === 'Viagens_excluirRegistro') {
            let idExcluir = args[0];
            if (window.ESTADO_APP && window.ESTADO_APP.dadosBD) {
               window.ESTADO_APP.dadosBD = window.ESTADO_APP.dadosBD.filter(i => String(i.ID) !== String(idExcluir));
               localStorage.setItem('DADOS_VIAGEM_CACHE', JSON.stringify(window.ESTADO_APP.dadosBD));
               if (typeof window.UI_renderizarInterface === 'function') window.UI_renderizarInterface();
            }
            if (String(idExcluir).startsWith('temp_')) {
                filaSync = filaSync.filter(i => i.id_local !== idExcluir);
            } else {
                filaSync.push({ funcao: prop, parametros: args, id_local: Date.now() });
            }
         }
         else {
             filaSync.push({ funcao: prop, parametros: args, id_local: Date.now() });
         }

         localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filaSync));
         if (typeof SyncAPP_atualizarInterface === 'function') SyncAPP_atualizarInterface();
         if (onSuccess) setTimeout(() => onSuccess({ status: "sucesso_local" }), 50); 
         return; 
      }

      // 🔍 2. LEITURA: Busca do Google, mas NUNCA trava se falhar (Usa o Cache)
      try {
        if (!navigator.onLine) throw new Error("offline");
        
        const req = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
          body: JSON.stringify({ funcao: prop, parametros: args })
        });
        
        if (!req.ok) throw new Error("Servidor Google indisponível");

        const res = await req.json();
        if (res.status === 'sucesso') {
           // Guarda no Cache de Segurança
           localStorage.setItem('CACHE_LEITURA_' + prop, JSON.stringify(res.dados));
           if (onSuccess) onSuccess(res.dados);
        } else {
           throw new Error(res.mensagem || "Erro na API");
        }
      } catch (e) {
        console.warn("⚠️ Sem conexão ou link quebrado. Carregando dados offline para:", prop);
        const cacheSalvo = localStorage.getItem('CACHE_LEITURA_' + prop);
        
        // Salva a App de ficar presa na tela de Loading!
        if (cacheSalvo && onSuccess) {
            onSuccess(JSON.parse(cacheSalvo));
        } else if (onSuccess) {
            onSuccess([]); // Devolve um array vazio para forçar o ecrã a abrir
        } else if (onFailure) {
            onFailure(e);
        }
      }
    };
  }
});

// 🔄 FUNÇÃO DO BOTÃO MANUAL DE SINCRONIZAÇÃO
window.App_ProcessarFilaManual = async function() {
  const filaSync = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
  if (filaSync.length === 0) return; 

  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');
  
  if(icon) icon.className = 'fas fa-sync fa-spin text-warning';
  if(text) text.innerText = 'A enviar...';

  let filaRestante = [];
  let sucessos = 0;

  for (let i = 0; i < filaSync.length; i++) {
    const item = filaSync[i];
    try {
      const req = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ funcao: item.funcao, parametros: item.parametros })
      });
      const res = await req.json();
      if (res.status === 'sucesso') sucessos++;
      else console.warn("Erro no servidor descartado:", res.mensagem);
    } catch (err) {
      filaRestante.push(item); 
    }
  }

  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filaRestante));
  if (typeof SyncAPP_atualizarInterface === 'function') SyncAPP_atualizarInterface();

  if (filaRestante.length === 0) {
    if(typeof Swal !== 'undefined') Swal.fire('Tudo Salvo!', 'Dados guardados na nuvem.', 'success');
  } else {
    if(typeof Swal !== 'undefined') Swal.fire('Aviso', 'A internet falhou a meio. Ficaram ' + filaRestante.length + ' pendentes.', 'warning');
  }

  if (sucessos > 0 && typeof window.Api_buscarDados === 'function') {
      window.Api_buscarDados(true);
  }
};
/* ================================================================= */

// =======================================================
// 🧠 MÓDULO: 06_Js_Global.html (ESTADO E CACHE)
// =======================================================
var ESTADO_APP = {
  viagemAtual: localStorage.getItem('VIAGEM_ATIVA') || "",
  dadosBD: [],
  config: { viagens: [], categoriasRoteiro: [] }
};


// =======================================================
// 📱 INTEGRAÇÃO COM HARDWARE: BOTÃO VOLTAR NATIVO
// =======================================================
let historicoModais = [];

// Chama esta função SEMPRE que abrires um modal (ex: no onclick do botão)
function App_registrarAberturaModal(idDoModal) {
  historicoModais.push(idDoModal);
  // Cria uma página "falsa" no histórico do telemóvel
  history.pushState({ modalAberto: idDoModal }, "");
}

// Ouve o botão físico de voltar do Android
window.addEventListener('popstate', function(event) {
  if (historicoModais.length > 0) {
    // Pega o último modal aberto
    const ultimoModal = historicoModais.pop();
    const elementoModal = document.getElementById(ultimoModal);
    
    // Esconde o modal em vez de fechar o aplicativo
    if (elementoModal) {
      elementoModal.style.display = 'none';
      // Se usares SweetAlert, fecha-o também
      if (typeof Swal !== 'undefined') Swal.close(); 
    }
  }
});

// DICA DE IMPLEMENTAÇÃO:
// Na tua função que abre modais (ex: UI_abrirModal('modal-atividade')), 
// adiciona a linha: App_registrarAberturaModal('modal-atividade');

/* =================================================================
 * 📱 MOTOR DE NAVEGAÇÃO NATIVA (BOTÃO VOLTAR DO CELULAR)
 * ================================================================= */
window.App_ModaisAbertos = [];

// Função que substitui o teu antigo: App_AbrirTela('...', 'block')
window.App_AbrirTela = function(idModal, tipoDisplay = 'block') {
  const elemento = document.getElementById(idModal);
  if (elemento) {
    elemento.style.display = tipoDisplay;
    window.App_ModaisAbertos.push(idModal);
    
    // MÁGICA: Avisa o celular que uma nova "página" abriu
    history.pushState({ modalAtivo: idModal }, "");
  }
};

// O "Ouvinte" que deteta quando o botão físico de voltar é apertado
window.addEventListener('popstate', function(event) {
  
  // 1. Se houver um aviso do SweetAlert aberto, fecha só o aviso primeiro!
  if (typeof Swal !== 'undefined' && Swal.isVisible()) {
    Swal.close();
    // Devolve o histórico para não quebrar a ordem do modal que está por baixo
    history.pushState(event.state, ""); 
    return;
  }

  // 2. Se houver modais abertos, fecha o último que foi aberto
  if (window.App_ModaisAbertos.length > 0) {
    const ultimoModal = window.App_ModaisAbertos.pop();
    const elemento = document.getElementById(ultimoModal);
    if (elemento) {
      elemento.style.display = 'none';
    }
  }
});


// =======================================================
// 🌐 MÓDULO: 07_Js_Api.html (PONTE FRONT-BACK)
// =======================================================

/**
 * 📡 Api_buscarDados
 * Gerencia a busca de dados no servidor com suporte a Sincronização em Background,
 * Proteção de Optimistic UI e Gerenciamento de Cache Offline.
 */
function Api_buscarDados(isBackgroundSync = false) {
  const overlay = document.getElementById('loading-overlay');
  
  // 1. Controle visual: só exibe o carregamento se não for uma atualização silenciosa
  if (!isBackgroundSync && overlay) {
    overlay.style.display = 'flex';
  }

  google.script.run
    .withSuccessHandler(dados => {
      // Guarda uma cópia de segurança de todos os dados recebidos do servidor
      try { localStorage.setItem('CACHE_VIAGENS', JSON.stringify(dados)); } catch(e) {}
      
      // Atualiza as configurações e categorias globais do app
      ESTADO_APP.config.viagens = dados.viagens;
      ESTADO_APP.config.viagensInfo = dados.viagensInfo;
      ESTADO_APP.config.categoriasRoteiro = dados.categoriasRoteiro;
      ESTADO_APP.config.categoriasChecklist = dados.categoriasChecklist; 

      /**
       * 🛡️ PROTEÇÃO OPTIMISTIC UI (CRÍTICO)
       * Se o usuário criou gastos ou atividades offline, eles estão na FILA_SYNC_VIAGENS.
       * Verificamos a fila antes de aceitar os dados do banco para evitar rollbacks visuais.
       */
      const filaPendente = JSON.parse(localStorage.getItem('FILA_SYNC_VIAGENS') || '[]');
      
      if (filaPendente.length > 0) {
         // Se há itens esperando para subir, mantemos a nossa versão local da "verdade"
         const cacheLocalInterativo = localStorage.getItem('DADOS_VIAGEM_CACHE');
         if (cacheLocalInterativo) {
            ESTADO_APP.dadosBD = JSON.parse(cacheLocalInterativo);
         } else {
            ESTADO_APP.dadosBD = dados.bd;
         }
      } else {
         // Se a fila está vazia, o servidor é a fonte da verdade mais atualizada
         ESTADO_APP.dadosBD = dados.bd;
         // Sincroniza o cache local de trabalho com a versão limpa do servidor
         localStorage.setItem('DADOS_VIAGEM_CACHE', JSON.stringify(dados.bd)); 
      }

      // Define a viagem ativa caso ainda não tenha sido selecionada
      if (!ESTADO_APP.viagemAtual && dados.viagens.length > 0) {
        ESTADO_APP.viagemAtual = dados.viagens[0];
        localStorage.setItem('VIAGEM_ATIVA', ESTADO_APP.viagemAtual);
      }

      // Atualiza todas as telas (Roteiro, Gastos, Mala) instantaneamente
      UI_renderizarInterface();

      // Esconde o carregamento
      if (overlay) overlay.style.display = 'none';
    })
    .withFailureHandler(err => {
      // 🛡️ Blindagem contra erros de rede: esconde o loading para não travar a UI
      if (overlay) overlay.style.display = 'none';
      
      /**
       * 🌟 SILÊNCIO: Se falhar em background, não incomodamos o usuário com pop-ups.
       * Só mostramos o alerta se ele clicou propositalmente em um botão de atualizar.
       */
      if (!isBackgroundSync) {
        Swal.fire({
          title: 'Modo Offline',
          text: 'Não foi possível conectar ao servidor. Carregando dados do aparelho...',
          icon: 'info',
          confirmButtonColor: 'var(--accent)'
        });
      }
      
      // Tenta recuperar os dados do armazenamento local (LocalStorage)
      Api_carregarDoCacheOffline(isBackgroundSync);
    })
    .Viagens_getDadosIniciais();
}

/**
 * 💾 Api_carregarDoCacheOffline
 * Recupera o estado do App sem necessidade de internet.
 */
function Api_carregarDoCacheOffline(isBackgroundSync = false) {
  const cacheBase = localStorage.getItem('CACHE_VIAGENS');      // Cópia da estrutura da última conexão
  const cacheLocal = localStorage.getItem('DADOS_VIAGEM_CACHE'); // Registros de gastos/atividades locais

  if (cacheBase) {
    const dados = JSON.parse(cacheBase);
    
    // Recupera categorias e infos de viagem do cache
    ESTADO_APP.config.viagens = dados.viagens;
    ESTADO_APP.config.viagensInfo = dados.viagensInfo;
    ESTADO_APP.config.categoriasRoteiro = dados.categoriasRoteiro;
    ESTADO_APP.config.categoriasChecklist = dados.categoriasChecklist; 
    
    // 🛡️ PRIORIDADE LOCAL: Usa os dados que contêm os gastos pendentes de envio
    if (cacheLocal) {
        ESTADO_APP.dadosBD = JSON.parse(cacheLocal);
    } else {
        ESTADO_APP.dadosBD = dados.bd;
    }
    
    UI_renderizarInterface();
  } else {
    // Se não houver absolutamente nada salvo no celular
    if (!isBackgroundSync) {
        Swal.fire('Erro Crítico', 'Você está sem internet e não possui dados salvos no celular.', 'error');
    }
  }
}


// =======================================================
// 🖥️ MÓDULO: 08_Js_UI.html (INTERFACE, ABAS E DEEP LINKS)
// =======================================================

// 🌟 NOVO: Flag para auto-filtrar "Hoje" apenas na primeira vez que abre o roteiro
let AUTO_FILTRO_HOJE_APLICADO = false;

// 🌟 GARANTINDO QUE A VARIÁVEL GLOBAL ESTÁ NO TOPO
let ABA_ATIVA = 'roteiro';

// 🌟 NOVO: Controle dos Filtros de Dias do Roteiro
let DIA_FILTRO_ROTEIRO = 'Todos';

// 🌟 FASE 1: Controle de Visibilidade de Notas/Post-its
let MOSTRAR_NOTAS = true;

// 🌟 NOVO: Estados de Controle do Extrato e Gráfico
let FILTRO_CAT_GASTO = 'Todos';
let ORDEM_GASTO = localStorage.getItem('ORDEM_GASTO_SALVA') || 'hierarquia';
let TERMO_BUSCA_GASTO = '';
let GRAFICO_GASTOS_INSTANCIA = null;
let GRAFICO_TIPO_ATUAL = 'doughnut'; // 'doughnut' ou 'bar'
let GRAFICO_MODO_ATUAL = 'categoria'; // 'categoria' ou 'status'

// =======================================================
// 🌟 FASE 1: FUNÇÕES AUXILIARES E ÍCONES INTELIGENTES
// =======================================================

// Função para alternar a visualização das Notas
function UI_toggleNotas() {
  MOSTRAR_NOTAS = !MOSTRAR_NOTAS;
  UI_vibrar(20);
  UI_renderizarRoteiro();
}

// Motor de Ícones Inteligentes para as Notas baseados no título
function Roteiro_getSmartIcon(texto) {
  let t = texto.toLowerCase();
  if(t.includes('uber') || t.includes('taxi') || t.includes('carro') || t.includes('transfer')) return '🚗';
  if(t.includes('voo') || t.includes('aeroporto') || t.includes('embarque')) return '✈️';
  if(t.includes('trem') || t.includes('metro') || t.includes('estação')) return '🚇';
  if(t.includes('ingresso') || t.includes('ticket') || t.includes('bilhete')) return '🎫';
  if(t.includes('comer') || t.includes('restaurante') || t.includes('lanche') || t.includes('jantar')) return '🍔';
  if(t.includes('hotel') || t.includes('check-in') || t.includes('hostel')) return '🏨';
  return '📌';
}

function UI_setFiltroRoteiro(dia) {
  UI_vibrar(20); // Vibracall ao tocar no filtro
  DIA_FILTRO_ROTEIRO = dia;
  UI_renderizarRoteiro(); // Atualiza a tela instantaneamente
}

// 🌟 MOTOR DE VIBRAÇÃO HÁPTICA
function UI_vibrar(padrao = 50) {
  if (navigator.vibrate) navigator.vibrate(padrao);
}

function UI_mudarAba(nomeAba) {
  ABA_ATIVA = nomeAba;
  UI_vibrar(30); // Vibração ao trocar de aba
  
  const telas = ['roteiro', 'extrato', 'checklist', 'galeria', 'mapa'];
  
  telas.forEach(tela => {
    const el = document.getElementById('tela-' + tela);
    if (el) {
      if (nomeAba === tela) {
        el.style.display = 'block';
        el.classList.add('tab-animada'); // Adiciona animação suave
      } else {
        el.style.display = 'none';
        el.classList.remove('tab-animada');
      }
    }
    
    const btn = document.getElementById('btn-nav-' + tela);
    if (btn) {
      btn.style.color = (nomeAba === tela) ? 'var(--accent)' : '#b0b0b0';
      btn.style.transform = (nomeAba === tela) ? 'scale(1.15)' : 'scale(1)';
      btn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
    }
  });
  
  UI_renderizarInterface();
}

// 🌟 RESTAURADA: Esta função é o coração do carregamento visual!
function UI_renderizarInterface() {
  const elTitulo = document.getElementById('ui-titulo-viagem');
  if (elTitulo) elTitulo.innerText = ESTADO_APP.viagemAtual || "Nenhuma Viagem";

  if (ABA_ATIVA === 'roteiro') UI_renderizarRoteiro();
  else if (ABA_ATIVA === 'extrato') UI_renderizarGastos();
  else if (ABA_ATIVA === 'checklist') UI_renderizarChecklist();
  else if (ABA_ATIVA === 'galeria') UI_renderizarGaleria();
}

// 🛡️ FUNÇÃO MATEMÁTICA INVENCÍVEL (Resolve o bug do 1309,24)
function Utils_garantirNumero(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).trim();
  if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(str) || 0;
}


/**
 * 🖥️ UI_renderizarRoteiro
 * Renderiza a Linha do Tempo da viagem ativa com suporte a filtros,
 * detecção de tempo livre (Gaps), indicadores de "Agora", Notas discretas,
 * botões de recursos (::), Drag & Drop e Valor monetário corrigido.
 * [VERSÃO CONSISTENTE - ACORDEÃO E BOTÕES PADRONIZADOS NAS NOTAS]
 */
function UI_renderizarRoteiro() {
  const container = document.getElementById('lista-roteiro');
  if (!container) return;

  // 1. FILTRA APENAS A VIAGEM ATUAL E REGISTROS DE ATIVIDADE
  let itensRoteiro = ESTADO_APP.dadosBD.filter(i => 
    i['Viagem'] === ESTADO_APP.viagemAtual && 
    i['Tipo_Registro'] === 'Atividade'
  );

  if (itensRoteiro.length === 0) {
    container.innerHTML = `<div class="text-center p-4 text-muted">Seu roteiro está vazio.<br>Clique no + para começar!</div>`;
    return;
  }

  // 2. ORDENAÇÃO CRONOLÓGICA FORÇADA
  itensRoteiro.sort((a, b) => {
    let dataA = new Date(String(a.Data_Hora || "").replace(" ", "T")).getTime() || 0;
    let dataB = new Date(String(b.Data_Hora || "").replace(" ", "T")).getTime() || 0;
    return dataA - dataB;
  });

  // 3. AGRUPAMENTO POR DIAS
  const diasMap = {};
  itensRoteiro.forEach(item => {
    const dia = item.Data_Hora ? String(item.Data_Hora).split(' ')[0] : 'Sem Data';
    if (!diasMap[dia]) diasMap[dia] = [];
    diasMap[dia].push(item);
  });

  const diasOrdenados = Object.keys(diasMap).sort();

  // 4. O "AGORA"
  const dataHojeStr = new Date().toISOString().split('T')[0];
  if (!AUTO_FILTRO_HOJE_APLICADO) {
    AUTO_FILTRO_HOJE_APLICADO = true;
    if (diasOrdenados.includes(dataHojeStr)) DIA_FILTRO_ROTEIRO = dataHojeStr;
  }

  // 🌟 FUNÇÃO AUXILIAR: GERADOR DO HTML DA NOTA RÁPIDA (GHOST MODE)
  const gerarHtmlNotaRapida = (dataBaseIso, tempoBadge = '', indexLinha = Math.random().toString(36).substr(2, 9)) => {
    let badgeHtml = tempoBadge ? `<span class="timeline-gap-text"><i class="fas fa-mug-hot me-1 text-warning"></i> ${tempoBadge}</span>` : '';
    let idGap = `gap-${indexLinha}`;
    
    return `
      <div class="timeline-gap" id="${idGap}">
        <div class="timeline-gap-trigger" onclick="
          UI_vibrar(10); 
          document.getElementById('${idGap}').classList.add('ativo'); 
          setTimeout(() => document.getElementById('input-${idGap}').focus(), 100);
        "></div>
        ${badgeHtml}
        <div class="timeline-gap-line"></div>
        <div class="timeline-gap-input-wrapper">
            <input type="text" id="input-${idGap}" placeholder="Nota rápida..." class="form-control" style="border-radius:8px; font-size:0.75rem; padding: 2px 10px; border: 1px dashed #bdc3c7; height: 26px; background: transparent; width: 100%;" onkeypress="if(event.key === 'Enter') Roteiro_salvarNotaInline(this, '${dataBaseIso}')" onblur="if(!this.value) document.getElementById('${idGap}').classList.remove('ativo')">
            <button class="btn btn-sm" onclick="Form_abrirDicaIntervalo('${dataBaseIso}')" style="background: #f1f3f5; color: var(--accent); border-radius: 8px; height: 26px; display: flex; align-items: center; padding: 0 8px;" title="Nota com anexos"><i class="fas fa-paperclip"></i></button>
        </div>
      </div>`;
  };

  // 5. RENDERIZAÇÃO DA BARRA DE FILTROS
  let htmlFiltros = `<div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 5px; scrollbar-width: none;">`;
  const btnStyleTodos = DIA_FILTRO_ROTEIRO === 'Todos' ? 'background: var(--accent); color: white;' : 'background: var(--card-bg); color: var(--secondary);';
  
  htmlFiltros += `<button onclick="UI_setFiltroRoteiro('Todos')" style="padding: 6px 14px; border: 1px solid #eee; border-radius: 16px; font-weight: 800; font-size: 0.75rem; white-space: nowrap; transition: 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.02); ${btnStyleTodos}">Visão Geral</button>`;
  htmlFiltros += `<button onclick="UI_toggleNotas()" style="padding: 6px 12px; border: 1px dashed #bdc3c7; border-radius: 16px; font-weight: 800; font-size: 0.7rem; color: #7f8c8d; transition: 0.3s;"><i class="fas ${MOSTRAR_NOTAS ? 'fa-eye-slash' : 'fa-eye'}"></i> ${MOSTRAR_NOTAS ? 'Ocultar Notas' : 'Mostrar Notas'}</button>`;

  diasOrdenados.forEach((dia, index) => {
    const partes = dia.split('-');
    const label = partes.length === 3 ? `${partes[2]}/${partes[1]}` : dia;
    const isActive = DIA_FILTRO_ROTEIRO === dia;
    let diaTexto = dia === dataHojeStr ? 'Hoje' : `Dia ${index+1}`;
    const btnStyle = isActive ? 'background: var(--accent); color: white; border: none;' : 'background: var(--card-bg); color: var(--secondary); border: 1px solid #eee;';
    htmlFiltros += `<button onclick="UI_setFiltroRoteiro('${dia}')" style="padding: 6px 14px; border-radius: 16px; font-weight: 800; font-size: 0.75rem; white-space: nowrap; transition: 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.02); ${btnStyle}">${diaTexto} (${label})</button>`;
  });
  htmlFiltros += `</div>`;

  // 6. RENDERIZANDO A LINHA DO TEMPO VIVA
  let htmlCards = '';
  const agoraReal = new Date();

  diasOrdenados.forEach(dia => {
    if (DIA_FILTRO_ROTEIRO !== 'Todos' && DIA_FILTRO_ROTEIRO !== dia) return;

    let atividadesDoDia = diasMap[dia];
    if (!MOSTRAR_NOTAS) atividadesDoDia = atividadesDoDia.filter(i => i['Categoria'] !== 'Anotação');
    if (atividadesDoDia.length === 0) return; 

    const partes = dia.split('-');
    const labelCabecalho = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dia;
    
    htmlCards += `
      <div style="display:flex; justify-content:space-between; align-items:center; margin: 20px 0 10px 0; border-bottom: 2px solid #f1f3f5; padding-bottom: 6px;">
        <span style="font-size: 0.8rem; font-weight: 900; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="far fa-calendar-alt text-accent me-1"></i> ${dia === dataHojeStr ? 'Hoje, ' : ''}${labelCabecalho}
        </span>
        <span style="font-size: 0.65rem; font-weight: 700; color: #95a5a6; background: #e9ecef; padding: 2px 8px; border-radius: 8px;">
          ${atividadesDoDia.length} parada${atividadesDoDia.length > 1 ? 's' : ''}
        </span>
      </div>
      <div class="timeline-wrapper">`;

    let dataFimAnterior = null;

    atividadesDoDia.forEach((item, index) => {
      let inicioStr = String(item['Data_Hora'] || "");
      let fimStr = String(item['Data_Hora_Fim'] || "");
      let inicioObj = inicioStr ? new Date(inicioStr.replace(" ", "T")) : new Date("invalid");
      let fimObj = fimStr ? new Date(fimStr.replace(" ", "T")) : null;
      let isNota = item['Categoria'] === 'Anotação';

      if (index === 0) {
        let dataAntes = !isNaN(inicioObj) ? new Date(inicioObj.getTime() - 5 * 60000) : new Date();
        let dataBaseFormAntes = new Date(dataAntes.getTime() - (dataAntes.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        htmlCards += gerarHtmlNotaRapida(dataBaseFormAntes, '');
      } else {
        let diffMs = !isNaN(inicioObj) && dataFimAnterior && !isNota ? (inicioObj - dataFimAnterior) : 0;
        let diffMins = Math.floor(diffMs / 60000);
        let tempoLivreTexto = '';

        if (diffMins > 15 && !isNota) {
          let h = Math.floor(diffMins / 60);
          let m = diffMins % 60;
          tempoLivreTexto = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
        }

        let dataReferencia = dataFimAnterior && !isNaN(dataFimAnterior) ? new Date(dataFimAnterior) : new Date();
        let dataMeio = new Date(dataReferencia.getTime() + 1 * 60000);
        let dataBaseFormMeio = new Date(dataMeio.getTime() - (dataMeio.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        
        htmlCards += gerarHtmlNotaRapida(dataBaseFormMeio, tempoLivreTexto);
      }

      let isAgora = false;
      if (!isNaN(inicioObj) && dataFimAnterior && !isNota) {
        if (agoraReal >= inicioObj && agoraReal <= dataFimAnterior) isAgora = true;
      }
      
      const markerClass = isAgora ? "timeline-marker agora" : "timeline-marker";
      let safeId = String(item['ID'] || index).replace(/'/g, "\\'");
      let safeTitulo = String(item['Titulo_Descricao']).replace(/'/g, "\\'"); // 🌟 Escapando o título para não quebrar a chamada JS

      const infoTempo = UI_formatarDataDuracao(item['Data_Hora'], item['Data_Hora_Fim']);
      const isPendente = item['Integridade'] === 'Pendente';
      
      // Padronização: Botoes Html serão gerados de forma idêntica tanto para Cards quanto para Notas
      let botoesHtml = ''; 
      
      if (item['Enderecos']) item['Enderecos'].split(' | ').forEach(end => {
        let txt = end.trim(); 
        if(txt) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : 'Maps';
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          let hrefReal = valorReal.toLowerCase().startsWith('http') ? valorReal : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(valorReal);
          botoesHtml += `<a href="${hrefReal}" target="_blank" class="btn btn-outline-danger" style="border-radius:6px; font-size:0.65rem; padding:3px 8px; margin: 0 4px 4px 0;"><i class="fas fa-map-marker-alt"></i> ${nomeExibicao}</a>`;
        }
      });
      
      if (item['Links']) item['Links'].split(' | ').forEach(lnk => {
        let txt = lnk.trim();
        if(txt) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : 'Link';
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          let hrefReal = valorReal.startsWith('http') ? valorReal : 'https://' + valorReal;
          botoesHtml += `<a href="${hrefReal}" target="_blank" class="btn btn-outline-primary" style="border-radius:6px; font-size:0.65rem; padding:3px 8px; margin: 0 4px 4px 0;"><i class="fas fa-link"></i> ${nomeExibicao}</a>`;
        }
      });
      
      if (item['Anexos']) item['Anexos'].split(' | ').forEach((anx, idx) => {
        let txt = anx.trim();
        if(txt && !txt.includes('ERRO_DRIVE')) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : `Anexo ${idx+1}`;
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          botoesHtml += `<a href="${valorReal}" target="_blank" class="btn btn-outline-success" style="border-radius:6px; font-size:0.65rem; padding:3px 8px; margin: 0 4px 4px 0;"><i class="fas fa-file-pdf"></i> ${nomeExibicao}</a>`;
        }
      });

      // RENDERIZAÇÃO: NOTA (POST-IT) - AGORA COM ACORDEÃO E BOTÕES PADRONIZADOS
      if (isNota) {
        let emoji = Roteiro_getSmartIcon(item['Titulo_Descricao'] || '');
        let descLimpa = item['Anotacoes'] ? String(item['Anotacoes']).split('\n').join('<br>') : '';
        
        const temDetalhes = descLimpa !== '' || botoesHtml !== '';
        const idUnico = 'detalhes-' + safeId; 
        const idIcone = 'icone-' + safeId;
        
        let htmlDetalhes = '';
        let iconeChevron = '';
        let onclickHeader = '';
        let cursorHeader = '';

        if (temDetalhes) {
            htmlDetalhes = `
            <div id="${idUnico}" style="display:none; margin-top:8px; padding-top:8px; border-top:1px dashed #e0e0e0;">
              ${descLimpa ? `<div style="font-size:0.75rem; color:#7f8c8d; margin-bottom:8px; line-height:1.3; font-weight:500;">${descLimpa}</div>` : ''}
              <div style="display:flex; flex-wrap: wrap;">${botoesHtml}</div>
            </div>`;
            
            iconeChevron = `<i id="${idIcone}" class="fas fa-chevron-down ms-1 text-muted" style="font-size: 0.65rem; transition: transform 0.3s; opacity: 0.5;"></i>`;
            cursorHeader = 'cursor: pointer;';
            onclickHeader = `onclick="UI_vibrar(10); let d = document.getElementById('${idUnico}'); let i = document.getElementById('${idIcone}'); if(d.style.display==='none'){d.style.display='block'; if(i)i.style.transform='rotate(180deg)';}else{d.style.display='none'; if(i)i.style.transform='rotate(0deg)';}"`;
        }

        htmlCards += `
          <div class="timeline-item" style="margin-bottom: 8px; cursor: grab;"
               draggable="true"
               ondragstart="event.dataTransfer.setData('text/plain', '${safeId}'); this.style.opacity='0.4';"
               ondragend="this.style.opacity='1';"
               ondragover="event.preventDefault();"
               ondrop="event.preventDefault(); Roteiro_drop(event, '${safeId}')">
               
            <div class="timeline-marker" style="width:8px; height:8px; left:-21px; top:14px; border-width:2px; border-color:#bdc3c7; background:#f8f9fa;"></div>
            <div class="nota-postit" style="background: rgba(255, 255, 255, 0.8); border-left: 3px solid #bdc3c7; padding: 8px 12px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
              
              <div ${onclickHeader} style="${cursorHeader} display:flex; justify-content:space-between; align-items:flex-start;">
                 <span style="font-weight:700; color:#444; font-size:0.85rem; line-height: 1.2;">
                   <span style="opacity: 0.8; margin-right: 2px;">${emoji}</span> ${item['Titulo_Descricao']} ${iconeChevron}
                 </span>
                 
                 <div onclick="event.stopPropagation(); UI_vibrar(20); Form_editarAtividade('${safeId}')" style="padding-left: 10px; opacity: 0.6;">
                   <i class="fas fa-edit" style="cursor:pointer; font-size: 0.85rem;"></i>
                 </div>
              </div>
              
              ${htmlDetalhes}
              
            </div>
          </div>`;
      } 
      // RENDERIZAÇÃO: CARD PRINCIPAL OTIMIZADO (ACORDEÃO ELEGÂNTE)
      else {
        const bordaEstilo = isPendente ? 'border-left: 4px solid #f39c12;' : 'border-left: 4px solid transparent;';
        const badgePendente = isPendente ? '<span class="badge bg-warning text-dark" style="font-size:0.5rem; padding: 2px 4px; letter-spacing: 0.3px;"><i class="fas fa-exclamation-triangle"></i> PENDENTE</span>' : '';
        const temDetalhes = item['Anotacoes'] || botoesHtml !== '';
        const idUnico = 'detalhes-' + safeId; 
        const idIcone = 'icone-' + safeId;
        
        let notasLimpas = item['Anotacoes'] ? String(item['Anotacoes']).split('\n').join('<br>') : '';
        let htmlNotasDetalhe = notasLimpas ? `<p style="font-size:0.75rem; color:var(--secondary); margin-bottom:6px; line-height:1.3;"><i class="fas fa-align-left me-1"></i> ${notasLimpas}</p>` : '';
        
        let htmlDetalhes = '';
        let iconeChevron = '';
        let onclickHeader = '';
        let cursorHeader = '';

        if (temDetalhes) {
            htmlDetalhes = `
            <div id="${idUnico}" style="display:none; margin-top:8px; padding-top:8px; border-top:1px dashed #eee;">
              ${htmlNotasDetalhe}
              <div style="display:flex; flex-wrap: wrap;">${botoesHtml}</div>
            </div>`;
            
            iconeChevron = `<i id="${idIcone}" class="fas fa-chevron-down ms-1 text-muted" style="font-size: 0.65rem; transition: transform 0.3s; opacity: 0.5;"></i>`;
            cursorHeader = 'cursor: pointer;';
            onclickHeader = `onclick="UI_vibrar(10); let d = document.getElementById('${idUnico}'); let i = document.getElementById('${idIcone}'); if(d.style.display==='none'){d.style.display='block'; if(i)i.style.transform='rotate(180deg)';}else{d.style.display='none'; if(i)i.style.transform='rotate(0deg)';}"`;
        }

        let valorCard = Utils_garantirNumero(item['Valor']);
        let htmlValor = '';
        if (valorCard > 0) {
            htmlValor = `<span style="font-size: 0.65rem; font-weight: 700; color: #7f8c8d; background: #f8f9fa; padding: 2px 6px; border-radius: 6px; border: 1px solid #f1f3f5; white-space: nowrap;"><i class="fas fa-wallet me-1" style="opacity:0.6;"></i>${valorCard.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>`;
        }

        htmlCards += `
          <div class="timeline-item">
            <div class="${markerClass}" style="top: 20px;"></div>
            <div class="roteiro-card" style="padding: 10px 12px; margin-bottom:0; box-shadow: 0 2px 8px rgba(0,0,0,0.03); border-radius: 12px; border: 1px solid #f1f3f5; ${bordaEstilo}">
              
              <div ${onclickHeader} style="${cursorHeader}">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                  <span style="font-size:0.65rem; font-weight:800; color: ${isAgora ? 'var(--danger)' : 'var(--secondary)'}; letter-spacing: 0.3px;"><i class="far fa-clock"></i> ${infoTempo.dataFormatada} <span style="color:var(--accent);">${infoTempo.duracao}</span></span>
                  <div style="display:flex; align-items:center; gap: 4px;">
                    ${badgePendente}
                    <span class="badge" style="background: rgba(52, 152, 219, 0.1); color: var(--accent); font-weight: 800; font-size: 0.55rem; padding: 2px 5px;">${item['Categoria'] || 'Geral'}</span>
                  </div>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
                  <h5 style="margin:0; font-weight:800; color:var(--primary); font-size: 0.95rem; line-height: 1.2;">
                    ${item['Titulo_Descricao']} ${iconeChevron}
                  </h5>
                  <div style="display:flex; align-items:center; gap: 8px; flex-shrink: 0;">
                    ${htmlValor}
                    
                    <div onclick="event.stopPropagation(); UI_vibrar(20); Gasto_abrirModal('${safeTitulo}')" style="background: rgba(231, 76, 60, 0.1); padding: 4px 6px; border-radius: 6px; transition: 0.2s;" title="Adicionar Gasto Extra">
                      <i class="fas fa-receipt text-danger" style="cursor:pointer; font-size: 0.85rem;"></i>
                    </div>

                    <div onclick="event.stopPropagation(); UI_vibrar(20); Form_editarAtividade('${safeId}')" style="background: #f8f9fa; padding: 4px 6px; border-radius: 6px; transition: 0.2s;">
                      <i class="fas fa-edit text-muted" style="cursor:pointer; font-size: 0.85rem;"></i>
                    </div>
                  </div>
                </div>
              </div>
              
              ${htmlDetalhes}
            </div>
          </div>`;
      }

      if (!isNota) {
        if (fimObj && !isNaN(fimObj)) dataFimAnterior = fimObj;
        else if (!isNaN(inicioObj)) dataFimAnterior = new Date(inicioObj.getTime() + 60 * 60000); 
      }
    });

    if (atividadesDoDia.length > 0 && dataFimAnterior && !isNaN(dataFimAnterior)) {
      let dataDepois = new Date(dataFimAnterior.getTime() + 5 * 60000);
      let dataBaseFormDepois = new Date(dataDepois.getTime() - (dataDepois.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      htmlCards += gerarHtmlNotaRapida(dataBaseFormDepois, '');
    }

    htmlCards += `</div>`; 
  });

  container.innerHTML = htmlFiltros + htmlCards;
}

/**
 * 🖥️ UI_renderizarGastos
 * Renderiza a aba de extrato financeiro.
 * [VERSÃO PREMIUM - EFEITO THREAD + SOMATÓRIO DE ADICIONAIS]
 */
function UI_renderizarGastos() {
  const containerExtrato = document.getElementById('tela-extrato');
  if (!containerExtrato) return;

  const todosItens = ESTADO_APP.dadosBD.filter(i => i['Viagem'] === ESTADO_APP.viagemAtual && (i['Tipo_Registro'] === 'Atividade' || i['Tipo_Registro'] === 'Gasto'));
  if (todosItens.length === 0) {
    containerExtrato.innerHTML = '<div class="text-center p-5 text-muted">Nenhum gasto registrado.<br>Use o botão + para começar.</div>';
    return;
  }

  // CÁLCULO INTELIGENTE DE MÉDIAS E TOTAIS
  let totalGeral = 0;
  let somaCategoriasGrafico = {};
  let somaStatusGrafico = { 'Pago Antes': 0, 'Gasto Local': 0 };
  
  let gastosPorDia = {};
  let gastosPorCategoria = {};
  let datasComGasto = new Set();
  let todasDatasViagem = [];

  todosItens.forEach(i => {
    let val = Utils_garantirNumero(i['Valor']);
    
    let dataLimpa = i['Data_Hora'] ? i['Data_Hora'].split(' ')[0] : 'Sem Data';
    if (dataLimpa !== 'Sem Data') todasDatasViagem.push(dataLimpa);

    if (val > 0) {
      totalGeral += val;
      
      let cat = i['Categoria'] || 'Geral';
      somaCategoriasGrafico[cat] = (somaCategoriasGrafico[cat] || 0) + val;
      gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + val;

      let statusPago = i['Status'] === 'Pago Antes' ? 'Pago Antes' : 'Gasto Local';
      somaStatusGrafico[statusPago] += val;

      if (dataLimpa !== 'Sem Data') datasComGasto.add(dataLimpa);
      if (!gastosPorDia[dataLimpa]) gastosPorDia[dataLimpa] = 0;
      gastosPorDia[dataLimpa] += val;
    }
  });

  let qtdDiasViagemTotal = 1;
  if (todasDatasViagem.length > 0) {
    todasDatasViagem.sort();
    let minD = new Date(todasDatasViagem[0] + "T00:00:00");
    let maxD = new Date(todasDatasViagem[todasDatasViagem.length - 1] + "T00:00:00");
    qtdDiasViagemTotal = Math.ceil(Math.abs(maxD - minD) / (1000 * 60 * 60 * 24)) + 1;
  }

  let qtdDiasComGasto = datasComGasto.size > 0 ? datasComGasto.size : 1;
  let mediaDiariaReal = totalGeral / qtdDiasComGasto;
  
  const configViagem = ESTADO_APP.config.viagensInfo ? ESTADO_APP.config.viagensInfo.find(v => v.nome === ESTADO_APP.viagemAtual) : null;
  const orcamentoTeto = configViagem ? parseFloat(configViagem.orcamento) : 0;
  
  let mediaIdeal = orcamentoTeto > 0 ? (orcamentoTeto / qtdDiasViagemTotal) : 0;
  let corMedia = '#f1c40f';
  if (orcamentoTeto > 0) {
    corMedia = (mediaDiariaReal > mediaIdeal) ? '#ff7675' : '#55efc4';
  }

  let previsaoTotal = mediaDiariaReal * qtdDiasViagemTotal;

  window.DADOS_RESUMO_DIARIO = {
    gastosPorDia, gastosPorCategoria, mediaDiariaReal, mediaIdeal, previsaoTotal, qtdDiasComGasto, orcamentoTeto
  };
  
  window.DADOS_GRAFICO_COMPLETO = {
    categoria: somaCategoriasGrafico,
    status: somaStatusGrafico,
    total: totalGeral
  };

  let pais = todosItens.filter(i => i['Tipo_Registro'] === 'Atividade');
  let filhosEAvulsos = todosItens.filter(i => i['Tipo_Registro'] === 'Gasto');
  let mapaFilhos = {};
  let avulsos = [];

  filhosEAvulsos.forEach(g => {
    let vinculo = g['Atividade_Vinculada'];
    if (vinculo) {
      if (!mapaFilhos[vinculo]) mapaFilhos[vinculo] = [];
      mapaFilhos[vinculo].push(g);
    } else {
      avulsos.push(g);
    }
  });

  let blocosParaRenderizar = [];

  pais.forEach(ativ => {
    let filhos = mapaFilhos[ativ['Titulo_Descricao']] || [];
    let valorPai = Utils_garantirNumero(ativ['Valor']);
    let valorFilhos = filhos.reduce((acc, f) => acc + Utils_garantirNumero(f['Valor']), 0);
    let totalBloco = valorPai + valorFilhos;

    if (totalBloco > 0) {
      blocosParaRenderizar.push({
        tipo: 'pai',
        item: ativ,
        filhos: filhos,
        totalBloco: totalBloco,
        dataRef: ativ['Data_Hora'] ? ativ['Data_Hora'].split(' ')[0] : '9999-99-99',
        nomeRef: ativ['Titulo_Descricao']
      });
    }
  });

  avulsos.forEach(av => {
    let valorAvulso = Utils_garantirNumero(av['Valor']);
    if (valorAvulso > 0) {
      blocosParaRenderizar.push({
        tipo: 'avulso',
        item: av,
        filhos: [],
        totalBloco: valorAvulso,
        dataRef: av['Data_Hora'] ? av['Data_Hora'].split(' ')[0] : '9999-99-99',
        nomeRef: av['Titulo_Descricao']
      });
    }
  });

  blocosParaRenderizar = blocosParaRenderizar.filter(b => {
    let passaCategoria = (FILTRO_CAT_GASTO === 'Todos' || b.item['Categoria'] === FILTRO_CAT_GASTO);
    let termo = TERMO_BUSCA_GASTO.toLowerCase();
    let passaBusca = termo === '' || 
                     b.item['Titulo_Descricao'].toLowerCase().includes(termo) || 
                     (b.item['Categoria'] || '').toLowerCase().includes(termo);
    return passaCategoria && passaBusca;
  });

  if (ORDEM_GASTO === 'preco') {
    blocosParaRenderizar.sort((a, b) => b.totalBloco - a.totalBloco);
  } else if (ORDEM_GASTO === 'data') {
    blocosParaRenderizar.sort((a, b) => a.dataRef.localeCompare(b.dataRef));
  } else if (ORDEM_GASTO === 'nome') {
    blocosParaRenderizar.sort((a, b) => a.nomeRef.localeCompare(b.nomeRef));
  }

  const categoriasExistentes = ['Todos', ...new Set(todosItens.map(i => i['Categoria']).filter(c => c))];
  let pillsHtml = '<div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; scrollbar-width: none;">';
  
  categoriasExistentes.forEach(cat => {
    let ativoClass = FILTRO_CAT_GASTO === cat ? 'ativo' : '';
    pillsHtml += `<button class="pill-filtro ${ativoClass}" onclick="UI_vibrar(20); Extrato_mudarFiltroCategoria('${cat}')">${cat}</button>`;
  });
  
  pillsHtml += '</div>';

  let htmlTela = `
    <div class="sticky-header-gastos" style="padding: 5px 0;">
      <div style="background: var(--primary); border-radius: 16px; padding: 10px 15px; color: white; box-shadow: 0 5px 15px rgba(44, 62, 80, 0.15);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h6 style="font-size: 0.65rem; font-weight: 600; text-transform: uppercase; margin: 0; opacity: 0.8;">Custo Total</h6>
            <h3 style="margin: 0; font-weight: 900; font-size: 1.3rem;">${totalGeral.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</h3>
          </div>
          <div style="text-align: right; cursor: pointer; background: rgba(0,0,0,0.15); padding: 6px 10px; border-radius: 10px; transition: 0.2s;"
            onclick="UI_vibrar(20); Extrato_abrirResumoDiario()">
            <h6 style="font-size: 0.6rem; font-weight: 600; text-transform: uppercase; margin: 0; opacity: 0.9;">Média Diária <i class="fas fa-hand-pointer ms-1"></i></h6>
            <h6 style="margin: 0; font-weight: 800; color: ${corMedia}; font-size: 0.85rem;">${mediaDiariaReal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}/dia</h6>
          </div>
        </div>
      </div>
    </div>
    
    <div style="padding: 0 2px;">
      <button id="btn-toggle-grafico" onclick="Extrato_toggleGrafico()" 
        class="btn btn-sm w-100 mt-2 mb-2" style="background: rgba(44, 62, 80, 0.05); color: var(--primary); border: 1px solid rgba(44, 62, 80, 0.1); border-radius: 8px; font-size: 0.75rem; font-weight: 700; transition: all 0.3s ease;">
        <i class="fas fa-chart-pie text-accent"></i> <span>Ver Gráfico de Categorias</span>
      </button>
      
      <div id="container-grafico" style="max-height: 0; opacity: 0; overflow: hidden; transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin 0.3s ease; background: white; border-radius: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
         <div style="padding: 15px;">
           <div style="display: flex; justify-content: space-between; margin-bottom: 15px; border-bottom: 1px solid #f1f3f5; padding-bottom: 10px;">
              <div style="display: flex; gap: 6px;">
                 <button onclick="Extrato_mudarModoGrafico('categoria')" id="btn-graf-cat" class="btn btn-sm" style="background: var(--accent); color: white; font-size: 0.65rem; border-radius: 12px; font-weight:700;">Categorias</button>
                 <button onclick="Extrato_mudarModoGrafico('status')" id="btn-graf-stat" class="btn btn-sm" style="background: #f1f3f5; color: var(--secondary); font-size: 0.65rem; border-radius: 12px; font-weight:700;">Pagamento</button>
              </div>
              <div style="display: flex; gap: 6px;">
                 <button onclick="Extrato_mudarTipoGrafico('doughnut')" id="btn-graf-rosca" class="btn btn-sm" style="background: var(--primary); color: white; font-size: 0.65rem; border-radius: 8px;"><i class="fas fa-chart-pie"></i></button>
                 <button onclick="Extrato_mudarTipoGrafico('bar')" id="btn-graf-bar" class="btn btn-sm" style="background: #f1f3f5; color: var(--secondary); font-size: 0.65rem; border-radius: 8px;"><i class="fas fa-chart-bar"></i></button>
              </div>
           </div>
           
           <div id="grafico-empty-state" style="display: none; text-align: center; padding: 20px 0; color: #95a5a6;">
              <i class="fas fa-receipt mb-2" style="font-size: 2rem; opacity: 0.3;"></i><br>
              <span style="font-size: 0.8rem; font-weight: 600;">Seus gastos aparecerão aqui.</span>
           </div>
           
           <div id="grafico-canvas-wrapper" style="position: relative; height: 160px;">
              <canvas id="graficoCanvas"></canvas>
           </div>
         </div>
      </div>

      <div style="margin-top: 10px;">
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
          <input type="text" class="form-control" placeholder="🔍 Buscar gasto..." value="${TERMO_BUSCA_GASTO}" onkeyup="Extrato_buscar(this.value)" style="border-radius: 12px; font-size: 0.85rem; border: 1px solid #ddd; flex: 1;">
          <select class="form-control" onchange="Extrato_mudarOrdem(this.value)" style="border-radius: 12px; font-size: 0.85rem; border: 1px solid #ddd; width: auto; font-weight: 600; color: var(--primary);">
            <option value="hierarquia" ${ORDEM_GASTO === 'hierarquia' ? 'selected' : ''}>📌 Padrão</option>
            <option value="preco" ${ORDEM_GASTO === 'preco' ? 'selected' : ''}>💰 Maior ao Menor</option>
            <option value="data" ${ORDEM_GASTO === 'data' ? 'selected' : ''}>📅 Mais Antigos</option>
            <option value="nome" ${ORDEM_GASTO === 'nome' ? 'selected' : ''}>🔤 A-Z</option>
          </select>
        </div>
        ${pillsHtml}
      </div>
    </div>
    <div style="padding-bottom: 30px;">
  `;

  if (blocosParaRenderizar.length === 0) {
    htmlTela += '<div class="text-center p-4 text-muted" style="font-size:0.85rem;">Nenhum gasto encontrado para estes filtros.</div>';
  } else {
    blocosParaRenderizar.forEach((bloco, index) => {
      let animDelay = index * 0.08; 
      let isPagoAntes = bloco.item['Status'] === 'Pago Antes';
      
      let badgePagamento = isPagoAntes ? 
        '<span class="badge" style="background: rgba(46, 204, 113, 0.1); color: #27ae60; font-size: 0.55rem; padding: 2px 6px; letter-spacing: 0.3px;">PAGO ANTES</span>' : 
        '<span class="badge" style="background: rgba(243, 156, 18, 0.1); color: #d35400; font-size: 0.55rem; padding: 2px 6px; letter-spacing: 0.3px;">GASTO LOCAL</span>';

      let safeIdBloco = String(bloco.item['ID']).replace(/'/g, "\\'");
      let safeTituloBloco = String(bloco.item['Titulo_Descricao']).replace(/'/g, "\\'");
      
      let dataPartes = bloco.dataRef !== '9999-99-99' ? bloco.dataRef.split('-') : [];
      let dataFormatada = dataPartes.length === 3 ? `${dataPartes[2]}/${dataPartes[1]}` : 'Sem Data';

      if (bloco.tipo === 'pai') {
        let valorPai = Utils_garantirNumero(bloco.item['Valor']);
        let valorFilhos = bloco.totalBloco - valorPai; // 🌟 NOVO: Cálculo do somatório dos filhos
        
        let htmlFilhos = '';
        bloco.filhos.forEach(filho => {
          let safeIdFilho = String(filho['ID']).replace(/'/g, "\\'");
          let vFilho = Utils_garantirNumero(filho['Valor']);
          let isPagoFilho = filho['Status'] === 'Pago Antes';
          let badgeFilho = isPagoFilho ? '<i class="fas fa-check-circle text-success" title="Pago Antes"></i>' : '<i class="fas fa-wallet text-warning" title="Gasto Local"></i>';
          
          htmlFilhos += `
            <div style="display:flex; justify-content:space-between; align-items:center; background: #f8f9fa; padding: 8px 10px; border-radius: 8px; position: relative; margin-bottom: 6px;">
              <div style="position: absolute; left: -14px; top: 15px; width: 14px; height: 2px; background: rgba(52, 152, 219, 0.3);"></div>
              
              <div style="display:flex; align-items:center; gap:8px; z-index: 2;">
                <span style="font-size: 0.75rem; color: #444; font-weight: 700;">${filho['Titulo_Descricao']}</span>
              </div>
              <div style="display:flex; align-items:center; gap: 8px; z-index: 2;">
                ${badgeFilho}
                <span style="font-size: 0.8rem; font-weight: 800; color: var(--danger);">${vFilho.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
                <i class="fas fa-edit text-muted" style="cursor:pointer; font-size: 0.85rem; padding: 2px;" onclick="event.stopPropagation(); UI_vibrar(20); Gasto_editarGasto('${safeIdFilho}')"></i>
              </div>
            </div>`;
        });

        // 🌟 NOVO: Bloco de Resumo Dinâmico (Custo Principal + Extras)
        let htmlCustoPai = '<div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;">';
        
        if (valorPai > 0) {
          htmlCustoPai += `
            <div style="font-size:0.75rem; color:#7f8c8d; font-weight:600; display: flex; align-items: center; gap: 6px;">
               <div style="width: 8px; height: 8px; border-radius: 50%; background: rgba(52, 152, 219, 0.5); z-index: 2;"></div>
               Custo Principal (Atividade): <span style="color: var(--primary);">${valorPai.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
            </div>`;
        }
        if (valorFilhos > 0) {
          htmlCustoPai += `
            <div style="font-size:0.75rem; color:#7f8c8d; font-weight:600; display: flex; align-items: center; gap: 6px;">
               <div style="width: 8px; height: 8px; border-radius: 50%; background: rgba(231, 76, 60, 0.5); z-index: 2;"></div>
               Custos Adicionais Extras: <span style="color: var(--danger);">+ ${valorFilhos.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</span>
            </div>`;
        }
        
        htmlCustoPai += '</div>';
          
        let idUnico = `filhos-${safeIdBloco}`;
        let idIcone = `icone-${safeIdBloco}`;
        
        let temFilhos = bloco.filhos.length > 0;
        let iconeChevron = temFilhos ? `<i id="${idIcone}" class="fas fa-chevron-down ms-1 text-muted" style="font-size: 0.65rem; transition: transform 0.3s; opacity: 0.5;"></i>` : '';
        let onclickHeader = temFilhos ? `onclick="UI_vibrar(10); let d = document.getElementById('${idUnico}'); let i = document.getElementById('${idIcone}'); d.classList.toggle('aberto'); if(d.classList.contains('aberto')){if(i)i.style.transform='rotate(180deg)';}else{if(i)i.style.transform='rotate(0deg)';}" style="cursor: pointer;"` : '';

        htmlTela += `
          <div class="card-gasto-animado" style="animation-delay: ${animDelay}s; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); border-left: 4px solid var(--primary);">
            <div ${onclickHeader}>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                <div style="display:flex; align-items:center; gap: 6px;">
                  <span style="font-size: 0.65rem; font-weight: 800; color: var(--secondary);"><i class="far fa-calendar-alt"></i> ${dataFormatada}</span>
                  <span class="badge" style="background: rgba(52, 152, 219, 0.1); color: var(--accent); font-weight: 800; font-size: 0.55rem; padding: 2px 5px; text-transform: uppercase;">${bloco.item['Categoria'] || 'Geral'}</span>
                  ${badgePagamento}
                </div>
                
                <div style="display: flex; align-items: center; gap: 6px;">
                  <div onclick="event.stopPropagation(); UI_vibrar(20); Gasto_abrirModal('${safeTituloBloco}')" style="background: rgba(231, 76, 60, 0.1); padding: 4px 6px; border-radius: 6px; transition: 0.2s;" title="Adicionar Gasto Extra">
                    <i class="fas fa-receipt text-danger" style="cursor:pointer; font-size: 0.85rem;"></i>
                  </div>
                  <div onclick="event.stopPropagation(); UI_vibrar(20); Form_editarAtividade('${safeIdBloco}')" style="background: #f8f9fa; padding: 4px 6px; border-radius: 6px; transition: 0.2s;">
                    <i class="fas fa-edit text-muted" style="cursor:pointer; font-size: 0.85rem;"></i>
                  </div>
                </div>
              </div>
              
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
                <h5 style="margin:0; font-weight:800; color:var(--primary); font-size: 0.95rem; line-height: 1.2;">
                  ${bloco.item['Titulo_Descricao']} ${iconeChevron}
                </h5>
                <div style="font-weight: 900; font-size: 1rem; color: var(--primary); flex-shrink: 0;">
                  ${bloco.totalBloco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </div>
              </div>
            </div>
            
            ${temFilhos ? `
            <div id="${idUnico}" class="gastos-filhos-container">
              <div style="padding-top: 12px; border-top: 1px dashed #eee; position: relative;">
                <div style="position: absolute; left: 3px; top: 18px; bottom: 18px; width: 2px; background: rgba(52, 152, 219, 0.3);"></div>
                
                ${htmlCustoPai}
                <div style="padding-left: 14px; position: relative;">
                  ${htmlFilhos}
                </div>
              </div>
            </div>` : ''}
          </div>`;
          
      } else {
        // Gasto Avulso
        htmlTela += `
          <div class="card-gasto-animado" style="animation-delay: ${animDelay}s; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); border-left: 4px solid var(--danger);">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                <div style="display:flex; align-items:center; gap: 6px;">
                  <span style="font-size: 0.65rem; font-weight: 800; color: var(--secondary);"><i class="far fa-calendar-alt"></i> ${dataFormatada}</span>
                  <span class="badge" style="background: rgba(52, 152, 219, 0.1); color: var(--accent); font-weight: 800; font-size: 0.55rem; padding: 2px 5px; text-transform: uppercase;">${bloco.item['Categoria'] || 'Geral'}</span>
                  ${badgePagamento}
                </div>
                <div onclick="event.stopPropagation(); UI_vibrar(20); Gasto_editarGasto('${safeIdBloco}')" style="background: #f8f9fa; padding: 4px 6px; border-radius: 6px; transition: 0.2s;">
                  <i class="fas fa-edit text-muted" style="cursor:pointer; font-size: 0.85rem;"></i>
                </div>
              </div>
              
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
                <h5 style="margin:0; font-weight:800; color:var(--primary); font-size: 0.95rem; line-height: 1.2;">
                  ${bloco.item['Titulo_Descricao']}
                </h5>
                <div style="font-weight: 900; font-size: 1rem; color: var(--danger); flex-shrink: 0;">
                  ${bloco.totalBloco.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </div>
              </div>
            </div>
          </div>`;
      }
    });
  }

  htmlTela += '</div>'; 
  containerExtrato.innerHTML = htmlTela;
}

// =======================================================
// FUNÇÕES AUXILIARES DA ABA EXTRATO / GASTOS
// =======================================================

function Extrato_mudarOrdem(novaOrdem) {
  ORDEM_GASTO = novaOrdem;
  localStorage.setItem('ORDEM_GASTO_SALVA', novaOrdem);
  UI_renderizarGastos();
}

function Extrato_mudarFiltroCategoria(cat) {
  FILTRO_CAT_GASTO = cat;
  UI_renderizarGastos();
}

function Extrato_buscar(termo) {
  TERMO_BUSCA_GASTO = termo;
  UI_renderizarGastos();
}

function Extrato_toggleAccordion(idContainer, btnEl) {
  const container = document.getElementById(idContainer);
  if (container.classList.contains('aberto')) {
    container.classList.remove('aberto');
    btnEl.innerHTML = `<i class="fas fa-chevron-down"></i> Ver gastos adicionais`;
  } else {
    container.classList.add('aberto');
    btnEl.innerHTML = `<i class="fas fa-chevron-up"></i> Esconder detalhes`;
  }
}

// =======================================================
// 🎨 ENGINE MAGNÉTICA DO GRÁFICO (Chart.js Avançado)
// =======================================================

function Extrato_toggleGrafico() {
  UI_vibrar(20);
  const container = document.getElementById('container-grafico');
  const btn = document.getElementById('btn-toggle-grafico');
  
  if (container.style.maxHeight === '0px' || container.style.maxHeight === '') {
    container.style.maxHeight = '500px'; 
    container.style.opacity = '1';
    container.style.marginTop = '10px';
    btn.innerHTML = `<i class="fas fa-chevron-up"></i> <span>Ocultar Gráfico</span>`;
    btn.style.background = 'rgba(0,0,0,0.2)';
    
    Extrato_renderizarChartJS();
  } else {
    container.style.maxHeight = '0px';
    container.style.opacity = '0';
    container.style.marginTop = '0px';
    btn.innerHTML = `<i class="fas fa-chart-pie"></i> <span>Ver Gráfico de Categorias</span>`;
    btn.style.background = 'rgba(255,255,255,0.1)';
  }
}

function Extrato_mudarModoGrafico(modo) {
  UI_vibrar(15);
  GRAFICO_MODO_ATUAL = modo;
  document.getElementById('btn-graf-cat').style.background = modo === 'categoria' ? 'var(--accent)' : '#f1f3f5';
  document.getElementById('btn-graf-cat').style.color = modo === 'categoria' ? 'white' : 'var(--secondary)';
  document.getElementById('btn-graf-stat').style.background = modo === 'status' ? 'var(--accent)' : '#f1f3f5';
  document.getElementById('btn-graf-stat').style.color = modo === 'status' ? 'white' : 'var(--secondary)';
  Extrato_renderizarChartJS();
}

function Extrato_mudarTipoGrafico(tipo) {
  UI_vibrar(15);
  GRAFICO_TIPO_ATUAL = tipo;
  document.getElementById('btn-graf-rosca').style.background = tipo === 'doughnut' ? 'var(--primary)' : '#f1f3f5';
  document.getElementById('btn-graf-rosca').style.color = tipo === 'doughnut' ? 'white' : 'var(--secondary)';
  document.getElementById('btn-graf-bar').style.background = tipo === 'bar' ? 'var(--primary)' : '#f1f3f5';
  document.getElementById('btn-graf-bar').style.color = tipo === 'bar' ? 'white' : 'var(--secondary)';
  Extrato_renderizarChartJS();
}

function Extrato_renderizarChartJS() {
  const canvas = document.getElementById('graficoCanvas');
  const ctx = canvas.getContext('2d');
  const wrapper = document.getElementById('grafico-canvas-wrapper');
  const emptyState = document.getElementById('grafico-empty-state');
  
  if (!window.DADOS_GRAFICO_COMPLETO) return;

  const dadosObj = window.DADOS_GRAFICO_COMPLETO[GRAFICO_MODO_ATUAL];
  const labels = Object.keys(dadosObj);
  const data = Object.values(dadosObj);
  const totalViagem = window.DADOS_GRAFICO_COMPLETO.total;
  
  if (data.length === 0 || totalViagem === 0 || data.every(v => v === 0)) {
    wrapper.style.display = 'none';
    emptyState.style.display = 'block';
    if (GRAFICO_GASTOS_INSTANCIA) GRAFICO_GASTOS_INSTANCIA.destroy();
    return;
  } else {
    wrapper.style.display = 'block';
    emptyState.style.display = 'none';
  }
  
  if (GRAFICO_GASTOS_INSTANCIA) GRAFICO_GASTOS_INSTANCIA.destroy();

  const paletaCategorias = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#34495e', '#1abc9c', '#e67e22'];
  const paletaStatus = ['#2ecc71', '#e67e22']; 

  const centerTextPlugin = {
    id: 'centerText',
    beforeDraw: function(chart) {
      if (chart.config.type !== 'doughnut') return;
      var width = chart.width, height = chart.height, ctx = chart.ctx;
      ctx.restore();
      
      var fontSize = (height / 120).toFixed(2);
      ctx.font = "900 " + fontSize + "em Inter, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#2c3e50"; 
      
      var text = totalViagem.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', maximumFractionDigits: 0});
      var textX = Math.round((width - ctx.measureText(text).width) / 2);
      if (chart.options.plugins.legend.position === 'right') textX -= (width * 0.15); 
      var textY = height / 2;
      
      ctx.fillText(text, textX, textY + 5);
      
      ctx.font = "800 " + (fontSize*0.4).toFixed(2) + "em Inter, sans-serif";
      ctx.fillStyle = "#95a5a6";
      var subText = "TOTAL";
      var subTextX = Math.round((width - ctx.measureText(subText).width) / 2);
      if (chart.options.plugins.legend.position === 'right') subTextX -= (width * 0.15);
      ctx.fillText(subText, subTextX, textY - (height/8));
      
      ctx.save();
    }
  };

  GRAFICO_GASTOS_INSTANCIA = new Chart(ctx, {
    type: GRAFICO_TIPO_ATUAL,
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: GRAFICO_MODO_ATUAL === 'status' ? paletaStatus : paletaCategorias,
        borderWidth: 2,
        borderColor: '#ffffff',
        borderRadius: GRAFICO_TIPO_ATUAL === 'bar' ? 6 : 0 
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: GRAFICO_TIPO_ATUAL === 'doughnut' ? '75%' : undefined,
      onClick: (e, activeElements) => {
        if (activeElements.length > 0 && GRAFICO_MODO_ATUAL === 'categoria') {
          const dataIndex = activeElements[0].index;
          const labelClicked = labels[dataIndex];
          Extrato_mudarFiltroCategoria(labelClicked); 
          UI_vibrar(30);
        }
      },
      plugins: {
        legend: { 
          display: GRAFICO_TIPO_ATUAL === 'doughnut',
          position: 'right', 
          labels: { font: { size: 10, family: 'Inter', weight: '600' }, usePointStyle: true, boxWidth: 8, padding: 15 } 
        },
        tooltip: {
          backgroundColor: 'rgba(44, 62, 80, 0.9)',
          titleFont: { size: 11, family: 'Inter' },
          bodyFont: { size: 13, weight: 'bold', family: 'Inter' },
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              let value = context.raw || 0;
              let percentage = totalViagem > 0 ? Math.round((value / totalViagem) * 100) : 0;
              let formatedValue = value.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
              return ` ${formatedValue} (${percentage}%)`;
            }
          }
        }
      },
      scales: GRAFICO_TIPO_ATUAL === 'bar' ? {
        y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: {size: 10, family: 'Inter'} } },
        x: { grid: { display: false }, ticks: { font: {size: 10, family: 'Inter', weight: 'bold'} } }
      } : { x: {display:false}, y: {display:false} }
    },
    plugins: GRAFICO_TIPO_ATUAL === 'doughnut' ? [centerTextPlugin] : []
  });
}

// =======================================================
// 💡 MODAL DE INTELIGÊNCIA FINANCEIRA (MÉDIA DIÁRIA)
// =======================================================
function Extrato_abrirResumoDiario() {
  const dados = window.DADOS_RESUMO_DIARIO;
  if (!dados) return;

  let forecastHtml = '';
  if (dados.orcamentoTeto > 0) {
    let percentual = (dados.previsaoTotal / dados.orcamentoTeto) * 100;
    let corForecast = percentual > 100 ? 'var(--danger)' : 'var(--success)';
    let msgForecast = percentual > 100 ? '⚠️ Mantendo este ritmo, vai ultrapassar o orçamento!' : '✅ Excelente! Ritmo seguro dentro do limite.';

    forecastHtml = `
      <div style="background: #f8f9fa; border-left: 5px solid ${corForecast}; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: left; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
        <div style="font-size: 0.7rem; font-weight: 800; color: var(--secondary); text-transform: uppercase; margin-bottom: 5px;">Previsão de Custo Final da Viagem</div>
        <div style="font-size: 1.4rem; font-weight: 900; color: ${corForecast};">${dados.previsaoTotal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</div>
        <div style="font-size: 0.75rem; font-weight: 700; color: #555; margin-top: 5px;">${msgForecast}</div>
        <div style="font-size: 0.7rem; font-weight: 600; color: #95a5a6; margin-top: 8px; border-top: 1px dashed #ddd; padding-top: 8px;">
          *Baseado na sua média atual de ${dados.mediaDiariaReal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}/dia.
        </div>
      </div>
    `;
  }

  let categoriasHtml = '<div style="font-size: 0.8rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 10px; text-align: left;"><i class="fas fa-chart-pie text-accent"></i> Média por Categoria</div>';
  categoriasHtml += '<div style="display:flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;">';
  
  for (const [cat, valor] of Object.entries(dados.gastosPorCategoria)) {
    let mediaCat = valor / dados.qtdDiasComGasto;
    categoriasHtml += `
      <div style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 10px; flex: 1 1 45%; text-align: left; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
        <div style="font-size: 0.65rem; font-weight: 800; color: var(--secondary); text-transform: uppercase;">${cat}</div>
        <div style="font-size: 0.85rem; font-weight: 800; color: var(--primary);">${mediaCat.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}/dia</div>
      </div>`;
  }
  categoriasHtml += '</div>';

  let diasHtml = '<div style="text-align: left;">';
  diasHtml += '<div style="font-size: 0.8rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 10px; border-bottom: 2px solid #f1f3f5; padding-bottom: 5px;"><i class="far fa-calendar-check text-success"></i> Gasto Exato por Dia</div>';

  let diasOrdenados = Object.keys(dados.gastosPorDia).sort();
  diasOrdenados.forEach(dia => {
    let partes = dia.split('-');
    let labelDia = partes.length === 3 ? `${partes[2]}/${partes[1]}` : dia;
    let valorDia = dados.gastosPorDia[dia];

    let corValor = (dados.orcamentoTeto > 0 && valorDia > dados.mediaIdeal) ? 'var(--danger)' : 'var(--primary)';

    diasHtml += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #f1f3f5;">
        <div style="font-size: 0.85rem; font-weight: 700; color: #555;">${labelDia}</div>
        <div style="font-size: 0.95rem; font-weight: 800; color: ${corValor};">${valorDia.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}</div>
      </div>
    `;
  });
  diasHtml += '</div>';

  Swal.fire({
    title: '<div style="text-align: left; color: var(--primary); font-weight: 900; font-size: 1.3rem;"><i class="fas fa-brain text-accent me-2"></i> Inteligência Financeira</div>',
    html: `<div style="max-height: 60vh; overflow-y: auto; padding-right: 5px; margin-top: 15px;">${forecastHtml} ${categoriasHtml} ${diasHtml}</div>`,
    showConfirmButton: false,
    showCloseButton: true,
    padding: '1.5em',
    customClass: { popup: 'rounded-4' }
  });
}

function UI_toggleMenuRoteiro() {
  UI_vibrar(20);
  const menu = document.getElementById('menu-roteiro-opcoes');
  menu.style.display = (menu.style.display === 'none' || menu.style.display === '') ? 'block' : 'none';
}

function UI_selecionarModoRoteiro(modo) {
  UI_mudarAba('roteiro');

  const listaContainer = document.getElementById('lista-roteiro-container');
  const mapaContainer = document.getElementById('mapa-roteiro-container');
  const telaMapa = document.getElementById('tela-mapa'); 
  const menuOpcoes = document.getElementById('menu-roteiro-opcoes');
  
  if (!listaContainer || !mapaContainer) return;

  if (modo === 'mapa') {
    listaContainer.style.display = 'none';
    mapaContainer.style.display = 'block';
    if (telaMapa) {
      telaMapa.style.display = 'block';
    }
    
    setTimeout(() => {
        if (typeof Mapa_abrirTela === 'function') {
          Mapa_abrirTela();
        }
    }, 50);
    
  } else {
    listaContainer.style.display = 'block';
    mapaContainer.style.display = 'none';
    if (telaMapa) {
      telaMapa.style.display = 'none';
    }
    UI_renderizarRoteiro();
  }

  if (menuOpcoes) {
    menuOpcoes.style.display = 'none';
  }
}

document.addEventListener('click', function(event) {
  const btnRoteiro = document.getElementById('btn-nav-roteiro');
  const menu = document.getElementById('menu-roteiro-opcoes');
  if (menu && btnRoteiro && !btnRoteiro.contains(event.target) && !menu.contains(event.target)) {
    menu.style.display = 'none';
  }
});

function UI_toggleSpeedDial() {
  UI_vibrar([20, 50, 20]); 
  document.body.classList.toggle('speed-dial-open');
}

function UI_formatarDataDuracao(inicioStr, fimStr) {
  if (!inicioStr) return { dataFormatada: 'Sem Horário', duracao: '' };
  const dataInicio = new Date(inicioStr.replace(" ", "T"));
  if (isNaN(dataInicio)) return { dataFormatada: inicioStr, duracao: '' };

  const dia = String(dataInicio.getDate()).padStart(2, '0');
  const mes = dataInicio.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
  const hora = String(dataInicio.getHours()).padStart(2, '0');
  const min = String(dataInicio.getMinutes()).padStart(2, '0');
  
  let textoData = `${dia} ${mes}, ${hora}:${min}`;
  let textoDuracao = "";

  if (fimStr) {
    const dataFim = new Date(fimStr.replace(" ", "T"));
    if (!isNaN(dataFim)) {
      const horaFim = String(dataFim.getHours()).padStart(2, '0');
      const minFim = String(dataFim.getMinutes()).padStart(2, '0');
      textoData += ` até ${horaFim}:${minFim}`;

      let diffMs = dataFim - dataInicio;
      if (diffMs > 0) {
        let minsTotais = Math.floor(diffMs / 60000);
        let h = Math.floor(minsTotais / 60);
        let m = minsTotais % 60;
        if (h > 0 && m > 0) textoDuracao = ` (${h}h ${m}m)`;
        else if (h > 0) textoDuracao = ` (${h}h)`;
        else textoDuracao = ` (${m}m)`;
      }
    }
  }
  return { dataFormatada: textoData, duracao: textoDuracao };
}

function UI_renderizarChecklist() {
  const container = document.getElementById('lista-checklist');
  if (!container) return;
  
  const itensChecklist = ESTADO_APP.dadosBD.filter(i => i['Viagem'] === ESTADO_APP.viagemAtual && i['Tipo_Registro'] === 'Checklist');
  
  if (itensChecklist.length === 0) {
    // 🌟 SEGURO: Sem quebras de linha perigosas
    container.innerHTML = '<div class="text-center p-4 text-muted">Nenhum item na mala ainda.<br>Clique no + para criar seu checklist!</div>';
    return;
  }

  const grupos = {};
  itensChecklist.forEach(item => {
    const cat = item['Categoria'] || 'Geral';
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(item);
  });

  let htmlCards = '';
  for (const [categoria, itens] of Object.entries(grupos)) {
    let itensHtml = '';
    itens.forEach(item => {
      const isConcluido = item['Status'] === 'Concluído';
      const textDecor = isConcluido ? 'text-decoration: line-through; color: #bdc3c7;' : 'color: var(--primary);';
      const iconCheck = isConcluido ? '<i class="fas fa-check-circle text-success"></i>' : '<i class="far fa-circle text-muted"></i>';
      
      // 🌟 BLINDAGEM DE IDs E STATUS NO CHECKLIST
      let safeId = String(item['ID']).replace(/'/g, "\\'");
      let safeStatus = String(item['Status']).replace(/'/g, "\\'");

      itensHtml += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f8f9fa;">
          <div onclick="Checklist_alternarStatus('${safeId}', '${safeStatus}')" style="display: flex; align-items: center; gap: 12px; flex: 1; cursor: pointer;">
            <div style="font-size: 1.2rem;">${iconCheck}</div>
            <div style="flex: 1; font-weight: 600; font-size: 0.95rem; ${textDecor}">${item['Titulo_Descricao']}</div>
          </div>
          <button onclick="Checklist_excluirItem('${safeId}', event)" style="background: transparent; border: none; color: #e74c3c; padding: 5px 10px; cursor: pointer; transition: 0.2s;">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      `;
    });

    htmlCards += `
      <div style="background: #fff; border-radius: 16px; padding: 15px; margin-bottom: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
        <h6 style="font-size: 0.8rem; font-weight: 800; color: var(--accent); text-transform: uppercase; margin-bottom: 10px;"><i class="fas fa-suitcase-rolling"></i> ${categoria}</h6>
        ${itensHtml}
      </div>
    `;
  }
  container.innerHTML = htmlCards;
}

/**
 * 🖥️ UI_renderizarGaleria
 * Renderiza a aba de Anexos, dividida entre Notas Gerais (Galeria - Recolhíveis)
 * e o Cofre Dinâmico de Documentos do Roteiro (Sem itens duplicados!).
 */
function UI_renderizarGaleria() {
  const container = document.getElementById('lista-galeria');
  if (!container) return;
  
  // 1. Puxa as Notas e Anexos GERAIS
  const notasGerais = ESTADO_APP.dadosBD.filter(i => 
    i['Viagem'] === ESTADO_APP.viagemAtual && 
    i['Tipo_Registro'] === 'Galeria'
  );

  // 2. Puxa os Anexos das atividades do ROTEIRO
  let itensComAnexos = ESTADO_APP.dadosBD.filter(i => 
    i['Viagem'] === ESTADO_APP.viagemAtual && 
    i['Tipo_Registro'] === 'Atividade' &&
    i['Anexos'] && String(i['Anexos']).trim() !== ''
  );
  
  itensComAnexos.sort((a, b) => {
    let dataA = new Date(String(a.Data_Hora || "").replace(" ", "T")).getTime() || 0;
    let dataB = new Date(String(b.Data_Hora || "").replace(" ", "T")).getTime() || 0;
    return dataA - dataB;
  });

  // 🌟 O NOVO BOTÃO DE ADICIONAR
  let htmlCards = `
    <button onclick="Galeria_abrirNovaNota()" class="btn w-100 mb-4" style="background: rgba(52, 152, 219, 0.1); color: var(--accent); border: 2px dashed var(--accent); border-radius: 16px; font-weight: 800; padding: 15px; display: flex; align-items: center; justify-content: center; gap: 10px;">
      <i class="fas fa-plus"></i> ADICIONAR NOTA OU ANEXO GERAL
    </button>
  `;

  // --- SEÇÃO 1: RENDERIZAR AS NOTAS GERAIS (AGORA RECOLHÍVEIS) ---
  if (notasGerais.length > 0) {
    htmlCards += `<h6 style="color: #7f8c8d; font-weight: 800; margin-bottom: 15px; text-transform: uppercase; font-size: 0.8rem;"><i class="fas fa-sticky-note me-2"></i>Suas Notas e Links Gerais</h6>`;
    htmlCards += `<div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 30px;">`;
    
    notasGerais.forEach(nota => {
      let safeId = String(nota['ID']).replace(/'/g, "\\'");
      let idUnico = 'conteudo-nota-' + safeId;
      let chevronId = 'chevron-nota-' + safeId;
      let botoesHtml = '';
      
      if (nota['Enderecos']) nota['Enderecos'].split(' | ').forEach(end => {
        let txt = end.trim(); if(txt) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : 'Maps';
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          let hrefReal = valorReal.toLowerCase().startsWith('http') ? valorReal : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(valorReal);
          botoesHtml += `<a href="${hrefReal}" target="_blank" class="btn btn-sm btn-outline-danger mt-1 me-1" style="border-radius:8px; font-size:0.75rem;"><i class="fas fa-map-marker-alt"></i> ${nomeExibicao}</a>`;
        }
      });
      if (nota['Links']) nota['Links'].split(' | ').forEach(lnk => {
        let txt = lnk.trim(); if(txt) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : 'Link';
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          let hrefReal = valorReal.startsWith('http') ? valorReal : 'https://' + valorReal;
          botoesHtml += `<a href="${hrefReal}" target="_blank" class="btn btn-sm btn-outline-primary mt-1 me-1" style="border-radius:8px; font-size:0.75rem;"><i class="fas fa-link"></i> ${nomeExibicao}</a>`;
        }
      });
      if (nota['Anexos']) nota['Anexos'].split(' | ').forEach((anx, idx) => {
        let txt = anx.trim(); if(txt && !txt.includes('ERRO_DRIVE')) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : `Anexo ${idx+1}`;
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          botoesHtml += `<a href="${valorReal}" target="_blank" class="btn btn-sm btn-outline-success mt-1 me-1" style="border-radius:8px; font-size:0.75rem;"><i class="fas fa-file-pdf"></i> ${nomeExibicao}</a>`;
        }
      });

      let descLimpa = nota['Anotacoes'] ? String(nota['Anotacoes']).split('\n').join('<br>') : '';
      let divDesc = descLimpa ? `<div style="font-size:0.8rem; color:var(--secondary); margin-top:8px;">${descLimpa}</div>` : '';

      // 🌟 MENTORIA: O Cartão agora é interativo! Clicar nele abre/fecha o conteúdo.
      htmlCards += `
        <div style="background: #fff; border-radius: 16px; padding: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.03); border-left: 4px solid var(--accent);">
          
          <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" 
               onclick="
                 UI_vibrar(10);
                 let box = document.getElementById('${idUnico}');
                 let icon = document.getElementById('${chevronId}');
                 if(box.style.display === 'none') {
                   box.style.display = 'block';
                   icon.style.transform = 'rotate(180deg)';
                 } else {
                   box.style.display = 'none';
                   icon.style.transform = 'rotate(0deg)';
                 }
               ">
            <div style="display:flex; align-items:center; gap: 10px;">
              <i id="${chevronId}" class="fas fa-chevron-down text-muted" style="transition: transform 0.3s ease; font-size: 0.9rem;"></i>
              <h6 style="margin:0; font-weight:800; color:var(--primary);">${nota['Titulo_Descricao']}</h6>
            </div>
            <i class="fas fa-edit text-muted" style="cursor:pointer; padding: 5px;" onclick="event.stopPropagation(); Form_editarNotaGeral('${safeId}')"></i>
          </div>

          <div id="${idUnico}" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #eee;">
            ${divDesc}
            ${botoesHtml ? `<div style="margin-top:8px;">${botoesHtml}</div>` : ''}
          </div>

        </div>
      `;
    });
    htmlCards += `</div>`;
  }

  // --- SEÇÃO 2: RENDERIZAR O COFRE DE DOCUMENTOS (Smart Cards Anti-Duplicação) ---
  htmlCards += `<h6 style="color: #7f8c8d; font-weight: 800; margin-bottom: 15px; text-transform: uppercase; font-size: 0.8rem;"><i class="fas fa-folder-open me-2"></i>Documentos do Roteiro</h6>`;
  
  if (itensComAnexos.length === 0) {
    htmlCards += `
      <div class="text-center p-4 text-muted" style="background: #fff; border-radius: 16px; border: 1px dashed #ddd;">
        <span style="font-size: 0.8rem;">Nenhum documento anexado nas atividades do roteiro.</span>
      </div>`;
  } else {
    htmlCards += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px;">';
    
    let linksProcessados = new Set();
    
    itensComAnexos.forEach(item => {
      const anexos = String(item['Anexos']).split(' | ').filter(a => a.trim() !== '');
      
      let iconCat = 'fa-file-alt'; let colorBg = '#e3f2fd'; let colorIcon = '#3498db';
      switch(item['Categoria']) {
        case 'Voo': iconCat = 'fa-plane'; colorBg = '#e8f4fd'; colorIcon = '#2980b9'; break;
        case 'Hospedagem': iconCat = 'fa-bed'; colorBg = '#f4ebf9'; colorIcon = '#8e44ad'; break;
        case 'Transporte': iconCat = 'fa-car'; colorBg = '#eafaf1'; colorIcon = '#27ae60'; break;
        case 'Passeios': iconCat = 'fa-camera-retro'; colorBg = '#fef5e7'; colorIcon = '#d35400'; break;
        case 'Alimentação e Bebidas': iconCat = 'fa-utensils'; colorBg = '#fdedec'; colorIcon = '#c0392b'; break;
        case 'Anotação': iconCat = 'fa-sticky-note'; colorBg = '#fef9e7'; colorIcon = '#f1c40f'; break;
        default: iconCat = 'fa-paperclip'; colorBg = '#f1f3f5'; colorIcon = '#7f8c8d'; break;
      }

      anexos.forEach((txt, index) => {
        if(txt && !txt.includes('ERRO_DRIVE')) {
          let partes = txt.split('::');
          let nomeExibicao = partes.length > 1 ? partes[0].trim() : 'Anexo ' + (index+1);
          let valorReal = partes.length > 1 ? partes[1].trim() : partes[0].trim();
          
          if (linksProcessados.has(valorReal)) {
              return; 
          }
          linksProcessados.add(valorReal);

          const dataCurta = item['Data_Hora'] ? item['Data_Hora'].split(' ')[0].split('-').reverse().slice(0,2).join('/') : '--/--';
          
          htmlCards += `
            <a href="${valorReal}" target="_blank" style="text-decoration: none; color: inherit; display: block;" onmouseover="this.querySelector('.smart-card-doc').style.transform='translateY(-3px)'; this.querySelector('.smart-card-doc').style.boxShadow='0 8px 15px rgba(0,0,0,0.08)';" onmouseout="this.querySelector('.smart-card-doc').style.transform='none'; this.querySelector('.smart-card-doc').style.boxShadow='0 4px 10px rgba(0,0,0,0.03)';">
              
              <div class="smart-card-doc" style="background: #fff; border-radius: 16px; padding: 15px; text-align: left; box-shadow: 0 4px 10px rgba(0,0,0,0.03); border: 1px solid #f1f3f5; transition: all 0.2s ease; height: 100%; display: flex; flex-direction: column;">
                
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                  <div style="width: 40px; height: 40px; background: ${colorBg}; color: ${colorIcon}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                    <i class="fas ${iconCat}"></i>
                  </div>
                  <span style="background: #f8f9fa; color: #7f8c8d; font-size: 0.65rem; padding: 3px 6px; border-radius: 6px; font-weight: 800; border: 1px solid #eee;">${dataCurta}</span>
                </div>
                
                <div style="font-size: 0.8rem; font-weight: 800; color: var(--primary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; margin-bottom: 8px;" title="${nomeExibicao}">
                  ${nomeExibicao}
                </div>
                
                <div style="margin-top: auto; font-size: 0.65rem; color: #95a5a6; border-top: 1px dashed #eee; padding-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item['Titulo_Descricao']}">
                  <i class="fas fa-map-pin me-1"></i> ${item['Titulo_Descricao']}
                </div>

              </div>
            </a>
          `;
        }
      });
    });
    htmlCards += '</div>';
  }

  container.innerHTML = htmlCards;
}


// =======================================================
// 🚀 MÓDULO: 09_Js_Main.html (BOOTSTRAPPER)
// =======================================================

window.onload = function() {
  // 1. Tenta carregar o cache primeiro para não ter tela em branco
  const cacheLocal = localStorage.getItem('CACHE_VIAGENS');
  if (cacheLocal) {
    Api_carregarDoCacheOffline();
    // 2. Busca atualizações em background silenciosamente
    Api_buscarDados(true);
  } else {
    // 3. Se não tem cache, força a tela de loading
    Api_buscarDados(false);
  }
};


// =======================================================
// ✏️ MÓDULO: 11_Js_Form.html (CONTROLO DE CADASTROS)
// =======================================================

let RECURSOS_TEMP = { enderecos: [], links: [], arquivos: [] };

let FORM_QTD = 1;
let ID_GRUPO_ATIVO = null;

// 🌟 GESTÃO DO MULTIPLICADOR (Exemplo 1)
function Form_mudarQtd(delta) {
  if (typeof UI_vibrar === 'function') UI_vibrar(20);
  FORM_QTD = Math.max(1, FORM_QTD + delta);
  document.getElementById('form-qtd').innerText = FORM_QTD;
  Form_calcularTotalMultiplicado();
}

function Form_calcularTotalMultiplicado() {
  const input = document.getElementById('form-valor');
  const totalDiv = document.getElementById('form-total-calc');
  const valorUnitario = parseFloat(input.value.replace(/\./g, '').replace(',', '.')) || 0;
  
  if (FORM_QTD > 1 && valorUnitario > 0) {
    const total = valorUnitario * FORM_QTD;
    totalDiv.innerText = `Total: ${total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}`;
    totalDiv.style.display = 'block';
  } else {
    totalDiv.style.display = 'none';
  }
}

/**
 * 🌟 Form_clonarAtividade
 * Clona uma atividade existente, permitindo a diluição de valores (Hospedagem)
 * e criando um vínculo de grupo (ID_Grupo) para gestão em massa.
 */
async function Form_clonarAtividade() {
  const idOriginal = document.getElementById('form-id').value;
  const categoria = document.getElementById('form-categoria').value;
  const titulo = document.getElementById('form-titulo').value;
  const valorStr = document.getElementById('form-valor').value;
  
  // 📐 Matemática Blindada: Calcula o valor total com base no multiplicador atual
  const valorTotal = (parseFloat(valorStr.replace(/\./g, "").replace(",", ".")) || 0) * FORM_QTD;

  let qtdRepeticoes = 1;
  let valorPorDia = valorTotal;
  let isHospedagem = (categoria === 'Hospedagem');

  // 1. Definição da estratégia de clonagem
  if (isHospedagem) {
    const { value: dias } = await Swal.fire({
      title: 'Diluir Hospedagem',
      text: 'Quantas diárias (noites) este valor cobre?',
      input: 'number',
      inputValue: 1,
      showCancelButton: true,
      confirmButtonText: 'Clonar e Substituir',
      cancelButtonText: 'Cancelar'
    });
    
    if (!dias || dias < 1) return;
    qtdRepeticoes = parseInt(dias);
    valorPorDia = valorTotal / qtdRepeticoes;
  } else {
    const result = await Swal.fire({ 
      title: 'Clonar Atividade?', 
      text: 'Deseja criar uma cópia idêntica deste registro?', 
      icon: 'question', 
      showCancelButton: true 
    });
    if (!result.isConfirmed) return;
  }

  // 2. Preparação do Grupo e Feedback Visual
  Swal.fire({ title: 'Processando...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

  // Gera um ID de Grupo Único para vincular todos os clones (Exemplo: GRP_171123456789)
  const novoIdGrupo = "GRP_" + Date.now();

  // 🛡️ ENVOLVEMOS AS PROMESSAS NUM TRY/CATCH PARA NÃO TRAVAR A TELA EM CASO DE ERRO
  try {
    
    // 🛡️ SUBSTITUIÇÃO BLINDADA: Adicionado withFailureHandler para evitar congelamento da exclusão
    if (idOriginal) {
      await new Promise((resolve, reject) => google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .Viagens_excluirRegistro(idOriginal));
    }

    // 3. Geração das Atividades Clonadas
    const dataInicioForm = document.getElementById('form-data-inicio').value;
    const dataFimForm = document.getElementById('form-data-fim').value;
    const dataBase = new Date(dataInicioForm);
    
    // Para hospedagem, criamos N diárias + 1 card de Check-out
    const totalCards = isHospedagem ? qtdRepeticoes + 1 : 1;

    for (let i = 0; i < totalCards; i++) {
      const dataRef = new Date(dataBase);
      dataRef.setDate(dataBase.getDate() + i);
      
      let horarioDefinido;
      let valorCard = valorPorDia;

      // Inteligência de Horários para Hospedagem
      if (isHospedagem) {
        if (i === 0) {
          // Dia 1: Mantém o horário de Check-in original
          horarioDefinido = dataInicioForm.split('T')[1];
        } else if (i === totalCards - 1) {
          // Último Dia: Horário de Check-out e Valor Zerado (já diluído nas diárias)
          horarioDefinido = dataFimForm.split('T')[1] || "12:00";
          valorCard = 0;
        } else {
          // Dias Intermediários: Fixa às 07:00h para ser o ponto de partida do dia
          horarioDefinido = "07:00";
        }
      } else {
        horarioDefinido = dataInicioForm.split('T')[1];
      }

      const dataFinalStr = dataRef.toISOString().split('T')[0] + " " + horarioDefinido;

      const payloadCopia = {
        Viagem: ESTADO_APP.viagemAtual,
        Tipo_Registro: 'Atividade',
        Status: 'Agendado',
        Titulo_Descricao: (isHospedagem && i === totalCards - 1) ? "Check-out: " + titulo : titulo,
        Categoria: categoria,
        Valor: valorCard,
        Data_Hora: dataFinalStr,
        Integridade: document.getElementById('form-pendente').checked ? 'Pendente' : 'Completo',
        ID_Grupo: novoIdGrupo, // 🔗 Vinculação do Grupo
        Enderecos: RECURSOS_TEMP.enderecos.join(' | '),
        Links: RECURSOS_TEMP.links.join(' | '),
        Anotacoes: document.getElementById('form-anotacoes').value,
        Usuario: "Admin"
      };

      // 🛡️ SUBSTITUIÇÃO BLINDADA: Envio síncrono com proteção de erro e rejeição adequada
      await new Promise((resolve, reject) => google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .Viagens_salvarRegistro(payloadCopia, []));
    }

    // 4. Finalização
    Swal.fire({ 
      title: 'Sucesso!', 
      text: isHospedagem ? 'Hospedagem diluída e organizada.' : 'Atividade duplicada.', 
      icon: 'success', 
      timer: 2000, 
      showConfirmButton: false 
    });
    
    Form_fecharModal();
    Api_buscarDados(true);

  } catch (erro) {
    // 🛡️ Se qualquer Promessa for rejeitada (falha de rede/backend), capturamos aqui!
    Swal.fire({
      title: 'Erro de Comunicação',
      text: 'Houve uma falha ao comunicar com o servidor: ' + erro.message,
      icon: 'error',
      confirmButtonColor: '#3498db'
    });
  }
}

// 🌟 Função Atualizada (Reseta a inteligência do Modal Minimalista)
function Form_abrirModal() {
  if (!ESTADO_APP.config.categoriasRoteiro || ESTADO_APP.config.categoriasRoteiro.length === 0) {
    Swal.fire('Aguarde', 'Sincronizando dados...', 'info'); return;
  }

  document.body.classList.remove('speed-dial-open');
  const form = document.getElementById('form-novo-registro');
  if (form) form.reset();
  
  document.getElementById('form-id').value = ""; 
  document.getElementById('titulo-modal-novo').innerHTML = '<i class="fas fa-map-pin me-2 text-accent"></i>Nova Atividade';
  
  const areaBotoes = document.getElementById('area-edicao-botoes');
  if (areaBotoes) areaBotoes.style.display = 'none';

  // 🛡️ REVELA OS CAMPOS (Caso tenham sido ocultos pela função de Notas)
  const elValor = document.getElementById('form-valor');
  if (elValor) elValor.parentNode.parentNode.style.display = 'block'; // Mostra o bloco financeiro
  const elDataFim = document.getElementById('form-data-fim');
  if (elDataFim) elDataFim.parentNode.style.display = 'block'; // Mostra a Data Fim

  FORM_QTD = 1;
  if (document.getElementById('form-qtd')) document.getElementById('form-qtd').innerText = "1";
  if (App_FecharTela('form-total-calc')) document.getElementById('form-total-calc');

  RECURSOS_TEMP = { enderecos: [], links: [], arquivos: [] };
  if (document.getElementById('lista-recursos-temp')) document.getElementById('lista-recursos-temp').innerHTML = '';
  
  Form_mudarTipoRecurso();

  const selCategoria = document.getElementById('form-categoria');
  if (selCategoria) {
    selCategoria.innerHTML = '<option value="">Selecione...</option>';
    ESTADO_APP.config.categoriasRoteiro.forEach(cat => {
      selCategoria.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
  }
  App_AbrirTela('modal-novo', 'flex');
}

// ==========================================================
// 🌟 AS NOVAS FUNÇÕES INTELIGENTES
// ==========================================================

// 💡 IDEIA 2: Modal Minimalista para Dicas
function Form_abrirDicaIntervalo(dataBaseStr) {
  UI_vibrar(20);
  Form_abrirModal(); // Abre o modal normalmente (limpando o formulário e resetando visibilidade)
  
  // Customiza a interface
  document.getElementById('titulo-modal-novo').innerHTML = '<i class="fas fa-sticky-note me-2 text-warning"></i>Nova Dica / Anotação';
  if (dataBaseStr) document.getElementById('form-data-inicio').value = dataBaseStr;

  // Força a Categoria "Anotação" (Ideia 5) e impede que ela vá para estatísticas financeiras
  const selCat = document.getElementById('form-categoria');
  if (!Array.from(selCat.options).some(o => o.value === 'Anotação')) {
      selCat.innerHTML += '<option value="Anotação">Anotação</option>';
  }
  selCat.value = 'Anotação';

  // Esconde burocracia financeira e datas irrelevantes
  document.getElementById('form-valor').value = 0;
  document.getElementById('form-valor').parentNode.parentNode.style.display = 'none';
  document.getElementById('form-data-fim').parentNode.style.display = 'none';
  
  setTimeout(() => document.getElementById('form-titulo').focus(), 150);
}

// 💡 IDEIA 4: Salvar Nota Ultra-Rápida direto da Linha do Tempo (Inline)
function Roteiro_salvarNotaInline(inputEl, dataBaseStr) {
  const titulo = inputEl.value.trim();
  if(!titulo) return;

  // 🌟 UX IMEDIATO: Limpa o campo e tira o foco instantaneamente! Fim da espera.
  inputEl.value = "";
  inputEl.disabled = true; // Previne duplo Enter acidental
  inputEl.blur();

  const payload = {
      Viagem: ESTADO_APP.viagemAtual,
      Tipo_Registro: 'Atividade',
      Status: 'Agendado',
      Data_Hora: dataBaseStr.replace("T", " "),
      Titulo_Descricao: titulo,
      Categoria: 'Anotação', // Isolamento perfeito
      Valor: 0,
      Integridade: 'Completo',
      Usuario: "Admin"
  };

  // 🌟 ENVIO EM BACKGROUND: Silencioso e seguro
  google.script.run
    .withSuccessHandler(res => {
        // Feedback discreto no canto superior
        Swal.fire({ title: 'Pronto!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
        UI_vibrar(20);
        Api_buscarDados(true); // Atualiza a tela silenciosamente
    })
    .withFailureHandler(err => {
        // Se der erro de internet, devolvemos o texto que o utilizador digitou!
        inputEl.disabled = false;
        inputEl.value = titulo;
        Swal.fire('Erro', 'Não foi possível guardar a nota rápida.', 'error');
    })
    .Viagens_salvarRegistro(payload, []);
}

/**
 * 🌟 Form_editarAtividade
 * Carrega os dados de uma atividade existente para consulta, edição ou clonagem.
 * Esta versão é blindada contra erros de "null" e gerencia grupos de clones.
 */
function Form_editarAtividade(id) {
  // 1. Localiza o item no estado global do App através do ID único [cite: 393, 394, 395]
  const item = ESTADO_APP.dadosBD.find(i => String(i.ID) === String(id));
  if (!item) {
    console.error("Erro: Atividade não encontrada no banco de dados local. ID: " + id);
    return;
  }

  // 2. Abre o modal de formulário e limpa estados de inserções anteriores [cite: 395]
  Form_abrirModal(); 
  
  // 3. Ajustes Visuais de Título e Botões de Ação [cite: 396]
  const elTituloModal = document.getElementById('titulo-modal-novo');
  if (elTituloModal) elTituloModal.innerHTML = '<i class="fas fa-edit me-2 text-accent"></i>Editar Atividade';
  
  // 🛡️ GESTÃO SEGURA DE BOTÕES: Exibe o grupo de Clonagem/Exclusão e oculta o botão antigo [cite: 398]
  const areaBotoes = document.getElementById('area-edicao-botoes');
  if (areaBotoes) areaBotoes.style.display = 'flex';

  const btnExcluirAntigo = document.getElementById('btn-excluir-atividade');
  if (btnExcluirAntigo) btnExcluirAntigo.style.display = 'none';

  // 4. Preenchimento de IDs e Identificadores de Grupo [cite: 400]
  document.getElementById('form-id').value = item.ID;
  
  // Armazena globalmente o ID do grupo para permitir exclusão em massa (Exemplo 3) [cite: 401]
  ID_GRUPO_ATIVO = item.ID_Grupo || null; 

  // 5. Preenchimento de Campos de Texto e Status [cite: 402]
  document.getElementById('form-titulo').value = item.Titulo_Descricao || "";
  
  // Carrega o status de Integridade (Marcação de Pendência - Exemplo 2) [cite: 403, 404]
  const elPendente = document.getElementById('form-pendente');
  if (elPendente) {
    elPendente.checked = (item.Integridade === 'Pendente');
  }

  // 6. Seleção de Categoria (com timeout para garantir o carregamento do select) [cite: 405]
  setTimeout(() => {
    const selCat = document.getElementById('form-categoria');
    if (selCat) selCat.value = item.Categoria || "";
  }, 50);

  // 7. Tratamento de Datas (Conversão do formato Planilha para datetime-local) [cite: 406, 407]
  if (item.Data_Hora) {
    document.getElementById('form-data-inicio').value = item.Data_Hora.replace(" ", "T");
  }
  if (item.Data_Hora_Fim) {
    document.getElementById('form-data-fim').value = item.Data_Hora_Fim.replace(" ", "T");
  }

  // 8. Tratamento Financeiro e Multiplicador [cite: 408]
  // Resetamos o multiplicador para 1, pois o valor vindo da planilha já é o total consolidado [cite: 408]
  FORM_QTD = 1;
  const elQtdDisplay = document.getElementById('form-qtd');
  if (elQtdDisplay) elQtdDisplay.innerText = "1";
  
  const elTotalCalc = document.getElementById('form-total-calc');
  if (elTotalCalc) elTotalCalc.style.display = 'none';

  // Formatação para exibição no campo monetário [cite: 410]
  const valorNumerico = parseFloat(String(item.Valor).replace(',', '.')) || 0;
  if (valorNumerico > 0) {
    document.getElementById('form-valor').value = valorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    document.getElementById('form-pago').checked = (item.Status === 'Pago Antes');
  }

  // Se for uma Dica/Anotação escondemos o campo de valor na edição também!
  if (item.Categoria === 'Anotação') {
      document.getElementById('form-valor').parentNode.parentNode.style.display = 'none';
      document.getElementById('form-data-fim').parentNode.style.display = 'none';
  }

  // 9. Notas e Recursos (Anotações, Endereços e Links) [cite: 412]
  document.getElementById('form-anotacoes').value = item.Anotacoes || "";

  // Recupera e separa os recursos do formato "Item 1 | Item 2" para o array temporário [cite: 413, 414]
  if (item.Enderecos) {
    RECURSOS_TEMP.enderecos = item.Enderecos.split(' | ').filter(e => e.trim() !== '');
  }
  if (item.Links) {
    RECURSOS_TEMP.links = item.Links.split(' | ').filter(e => e.trim() !== '');
  }
  
  // 10. Atualiza a lista visual de anexos/links no modal [cite: 415]
  Form_renderizarRecursos();
}

function Form_fecharModal() {
  App_FecharTela('modal-novo');
}

function Form_mascararValor(input) {
  let v = input.value.replace(/\D/g, ""); 
  if (v === "") { input.value = ""; return; }
  v = (parseInt(v) / 100).toFixed(2).replace(".", ",");
  v = v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  input.value = v;
}

function Form_mudarTipoRecurso() {
  const tipo = document.getElementById('tipo-recurso').value;
  const inputTexto = document.getElementById('valor-recurso-texto');
  const inputFile = document.getElementById('valor-recurso-file');

  // 🌟 Limpeza automática ao alternar as opções!
  inputTexto.value = ''; 
  inputFile.value = '';

  if (tipo === 'Anexo') {
    inputTexto.style.display = 'none';
    inputFile.style.display = 'block';
  } else {
    inputTexto.style.display = 'block';
    inputFile.style.display = 'none';
    inputTexto.placeholder = tipo === 'Endereco' ? 'Digite o endereço do local...' : 'Cole o link web (http)...';
  }
}

function Form_addRecurso() {
  const tipo = document.getElementById('tipo-recurso').value;
  const inputNome = document.getElementById('nome-recurso-texto');
  let nomeBotao = inputNome.value.trim();

  if (tipo === 'Anexo') {
    const fileInput = document.getElementById('valor-recurso-file');
    const file = fileInput.files[0];
    if (!file) return Swal.fire('Opa', 'Selecione um ficheiro.', 'warning');
    
    const limiteMB = 5;
    if (file.size > (limiteMB * 1024 * 1024)) return Swal.fire('Ficheiro muito grande', `Menos de ${limiteMB}MB.`, 'warning');
    
    // 🌟 Se não escreveu nome, usa o nome do próprio ficheiro
    if (!nomeBotao) nomeBotao = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
      RECURSOS_TEMP.arquivos.push({ 
        nomeOriginal: file.name, 
        nomePersonalizado: nomeBotao, // O nome inteligente!
        mime: file.type, 
        base64: e.target.result.split(',')[1] 
      });
      Form_renderizarRecursos();
      fileInput.value = ''; 
      inputNome.value = ''; // Limpa para o próximo
    };
    reader.readAsDataURL(file);
  } else {
    const inputTexto = document.getElementById('valor-recurso-texto');
    const valor = inputTexto.value.trim();
    if (!valor) return;
    
    // 🌟 Se não escreveu nome, usa um padrão ("Maps" ou "Link")
    if (!nomeBotao) nomeBotao = tipo === 'Endereco' ? 'Maps' : 'Link';
    
    // Constroi a string com o delimitador secreto
    const stringFinal = `${nomeBotao}::${valor}`;
    
    if (tipo === 'Endereco') RECURSOS_TEMP.enderecos.push(stringFinal);
    if (tipo === 'Link') RECURSOS_TEMP.links.push(stringFinal);
    
    inputTexto.value = '';
    inputNome.value = ''; // Limpa para o próximo
    Form_renderizarRecursos();
  }
}

function Form_renderizarRecursos() {
  const container = document.getElementById('lista-recursos-temp');
  container.innerHTML = '';
  
  // 🌟 MENTORIA: Estilo base para a tag <span> cortar o texto com "..."
  const spanStyle = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 85%; display: inline-block; vertical-align: middle;";
  const containerStyle = "display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; background:#fff; padding:5px 10px; border-radius:8px; border:1px solid #ddd; margin-bottom:5px;";

  RECURSOS_TEMP.enderecos.forEach((end, idx) => {
    let partes = end.split('::'); 
    let nomeExibicao = partes.length > 1 ? partes[0] : end; 
    container.innerHTML += `
      <div style="${containerStyle}">
        <span style="${spanStyle}" title="${nomeExibicao}"><i class="fas fa-map-marker-alt text-danger me-2"></i>${nomeExibicao}</span> 
        <i class="fas fa-times text-muted" style="cursor:pointer; padding:5px; flex-shrink: 0;" onclick="Form_removerRecurso('enderecos', ${idx})"></i>
      </div>`;
  });
  
  RECURSOS_TEMP.links.forEach((lnk, idx) => {
    let partes = lnk.split('::');
    let nomeExibicao = partes.length > 1 ? partes[0] : lnk;
    container.innerHTML += `
      <div style="${containerStyle}">
        <span style="${spanStyle}" title="${nomeExibicao}"><i class="fas fa-link text-primary me-2"></i>${nomeExibicao}</span> 
        <i class="fas fa-times text-muted" style="cursor:pointer; padding:5px; flex-shrink: 0;" onclick="Form_removerRecurso('links', ${idx})"></i>
      </div>`;
  });
  
  RECURSOS_TEMP.arquivos.forEach((arq, idx) => {
    container.innerHTML += `
      <div style="${containerStyle}">
        <span style="${spanStyle}" title="${arq.nomePersonalizado}"><i class="fas fa-file-pdf text-success me-2"></i>${arq.nomePersonalizado} (Pendente)</span> 
        <i class="fas fa-times text-muted" style="cursor:pointer; padding:5px; flex-shrink: 0;" onclick="Form_removerRecurso('arquivos', ${idx})"></i>
      </div>`;
  });
}

// 🌟 NOVA FUNÇÃO: Remove um recurso do "carrinho" antes de guardar
function Form_removerRecurso(tipo, index) {
  if (typeof UI_vibrar === 'function') UI_vibrar(20);
  RECURSOS_TEMP[tipo].splice(index, 1);
  Form_renderizarRecursos();
}

/**
 * 🛡️ Form_salvarRegistro (Atualizado para suportar Notas Gerais na Galeria)
 */
function Form_salvarRegistro() {
  const titulo = document.getElementById('form-titulo').value.trim();
  const categoria = document.getElementById('form-categoria').value;
  const valorStr = document.getElementById('form-valor').value;
  const idEdicao = document.getElementById('form-id').value;

  if (!titulo || !categoria) return Swal.fire('Atenção', 'Preencha Título e Categoria.', 'warning');

  // Captura de inputs esquecidos
  const inputEsquecido = document.getElementById('valor-recurso-texto').value.trim();
  const tipoDoc = document.getElementById('tipo-recurso').value;
  if (inputEsquecido && tipoDoc !== 'Anexo') {
    if (tipoDoc === 'Endereco') RECURSOS_TEMP.enderecos.push(inputEsquecido);
    if (tipoDoc === 'Link') RECURSOS_TEMP.links.push(inputEsquecido);
  }

  const valorUnitario = valorStr ? (parseFloat(valorStr.replace(/\./g, "").replace(",", ".")) || 0) : 0;
  const valorFinal = valorUnitario * FORM_QTD;

  // 🌟 A MÁGICA: Se a categoria for "Galeria", o Tipo de Registro também será para não misturar com o Roteiro!
  const tipoReg = categoria === 'Galeria' ? 'Galeria' : 'Atividade';

  const payload = {
    Viagem: ESTADO_APP.viagemAtual,
    Tipo_Registro: tipoReg,
    Status: valorFinal > 0 ? (document.getElementById('form-pago').checked ? 'Pago Antes' : 'Gasto Local') : 'Agendado',
    Data_Hora: document.getElementById('form-data-inicio').value.replace("T", " "),
    Data_Hora_Fim: document.getElementById('form-data-fim').value.replace("T", " "),
    Titulo_Descricao: titulo,
    Categoria: categoria,
    Valor: valorFinal,
    Integridade: document.getElementById('form-pendente').checked ? 'Pendente' : 'Completo',
    ID_Grupo: ID_GRUPO_ATIVO, 
    Enderecos: RECURSOS_TEMP.enderecos.join(' | '),
    Links: RECURSOS_TEMP.links.join(' | '),
    Anotacoes: document.getElementById('form-anotacoes').value,
    Usuario: "Admin"
  };

  if (idEdicao) payload.ID = idEdicao;

  if (idEdicao && ID_GRUPO_ATIVO) {
    Swal.fire({
      title: 'Atualizar Grupo?',
      text: "Deseja aplicar estas alterações a todos os dias desta hospedagem/clonagem?",
      icon: 'question',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Sim, em todos',
      denyButtonText: 'Apenas este',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3498db',
      denyButtonColor: '#95a5a6',
    }).then((result) => {
      if (result.isConfirmed) executarSalvamento(payload, true);
      else if (result.isDenied) executarSalvamento(payload, false); 
    });
  } else {
    executarSalvamento(payload, false);
  }
}

// =======================================================
// 📂 NOVAS FUNÇÕES: GESTÃO DO MODAL PARA A GALERIA
// =======================================================

function Galeria_abrirNovaNota() {
    UI_vibrar(20);
    Form_abrirModal(); // Limpa e prepara o modal padrão
    
    // Customiza a interface
    document.getElementById('titulo-modal-novo').innerHTML = '<i class="fas fa-folder-plus me-2 text-primary"></i>Nova Nota / Anexo Geral';
    
    // Oculta a burocracia (Data, Hora, Preço, Pendência)
    document.getElementById('form-data-inicio').parentNode.parentNode.style.display = 'none';
    document.getElementById('form-valor').parentNode.parentNode.style.display = 'none';
    document.getElementById('form-categoria').parentNode.style.display = 'none';
    
    const elPendente = document.getElementById('form-pendente');
    if(elPendente) elPendente.parentNode.style.display = 'none';
    
    // Força a Categoria secreta
    const selCat = document.getElementById('form-categoria');
    selCat.innerHTML = '<option value="Galeria">Galeria</option>';
    selCat.value = 'Galeria';
}

function Form_editarNotaGeral(id) {
    Form_editarAtividade(id); // Carrega os dados reais
    
    // Aplica o disfarce da Galeria
    document.getElementById('titulo-modal-novo').innerHTML = '<i class="fas fa-edit me-2 text-primary"></i>Editar Nota Geral';
    document.getElementById('form-data-inicio').parentNode.parentNode.style.display = 'none';
    document.getElementById('form-valor').parentNode.parentNode.style.display = 'none';
    document.getElementById('form-categoria').parentNode.style.display = 'none';
    
    const elPendente = document.getElementById('form-pendente');
    if(elPendente) elPendente.parentNode.style.display = 'none';
    
    const selCat = document.getElementById('form-categoria');
    if (!Array.from(selCat.options).some(o => o.value === 'Galeria')) {
        selCat.innerHTML += '<option value="Galeria">Galeria</option>';
    }
    selCat.value = 'Galeria';
}

function executarSalvamento(payload, emMassa) {
  // 🌟 MENTORIA: Fecha o modal imediatamente. Fim da espera!
  Form_fecharModal();
  
  const servidor = google.script.run;
  
  if (emMassa) {
    servidor
      .withSuccessHandler(res => finalizacaoSucesso())
      .withFailureHandler(err => Swal.fire('Erro ao salvar!', err.message, 'error'))
      // 🌟 CORREÇÃO: Agora enviamos os ARQUIVOS para a função de massa também!
      .Viagens_salvarEmMassa(payload, RECURSOS_TEMP.arquivos);
  } else {
    servidor
      .withSuccessHandler(res => finalizacaoSucesso())
      .withFailureHandler(err => Swal.fire('Erro ao salvar!', err.message, 'error'))
      .Viagens_salvarRegistro(payload, RECURSOS_TEMP.arquivos);
  }
}

function finalizacaoSucesso() {
  // 🌟 Exibe apenas o "Pronto!" de forma discreta (Toast não bloqueante) no canto superior
  Swal.fire({ title: 'Pronto!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  Api_buscarDados(true); // Atualiza os dados da tela silenciosamente
}


function Form_excluirAtividade() {
  const id = document.getElementById('form-id').value;
  if (!id) return;

  if (ID_GRUPO_ATIVO) {
    Swal.fire({
      title: 'Como deseja excluir?',
      text: "Esta atividade faz parte de um grupo clonado.",
      icon: 'warning',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Apenas esta',
      denyButtonText: 'O grupo todo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3498db',
      denyButtonColor: '#e74c3c',
    }).then((result) => {
      if (result.isConfirmed) {
        executarExclusao(id, false); // Exclui apenas um
      } else if (result.isDenied) {
        executarExclusao(ID_GRUPO_ATIVO, true); // Exclui o grupo
      }
    });
  } else {
    // Exclusão normal para itens sem grupo
    Swal.fire({ title: 'Excluir?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim' }).then(r => {
      if(r.isConfirmed) executarExclusao(id, false);
    });
  }
}

function executarExclusao(idOuGrupo, isGrupo) {
  // 🌟 MENTORIA: Liberta o ecrã instantaneamente
  Form_fecharModal(); 
  
  if (isGrupo) {
    google.script.run
      .withSuccessHandler(posExclusao)
      .withFailureHandler(err => Swal.fire('Erro ao excluir', err.message, 'error'))
      .Viagens_excluirPorGrupo(idOuGrupo);
  } else {
    google.script.run
      .withSuccessHandler(posExclusao)
      .withFailureHandler(err => Swal.fire('Erro ao excluir', err.message, 'error'))
      .Viagens_excluirRegistro(idOuGrupo);
  }
}

function posExclusao() {
  Swal.fire({ title: 'Excluído!', icon: 'success', toast: true, position: 'top-end', timer: 1500, showConfirmButton: false });
  Api_buscarDados(true);
}


// =======================================================
// 🔄 ENGINE DE DRAG & DROP (REORDENAÇÃO DE NOTAS)
// =======================================================

function Roteiro_drop(event, idAlvo) {
  // 1. Descobre quem é a nota que está a ser arrastada
  const idArrastada = event.dataTransfer.getData('text/plain');
  
  // Se largou no mesmo sítio, não faz nada
  if (!idArrastada || idArrastada === idAlvo) return;

  // 2. Localiza as duas notas na memória da aplicação
  const itemArrastado = ESTADO_APP.dadosBD.find(i => String(i.ID) === idArrastada);
  const itemAlvo = ESTADO_APP.dadosBD.find(i => String(i.ID) === idAlvo);

  if (!itemArrastado || !itemAlvo) return;

  // 3. A LÓGICA DA TROCA DO TEMPO (Chronological Swap)
  let tempoA = itemArrastado.Data_Hora;
  let tempoB = itemAlvo.Data_Hora;

  if (tempoA === tempoB) {
      // Se tiverem exatamente a mesma hora, subtraímos 1 minuto da nota arrastada para ela ficar "acima"
      let d = new Date(tempoA.replace(" ", "T"));
      d.setMinutes(d.getMinutes() - 1);
      // Formata de volta para o padrão "YYYY-MM-DD HH:mm"
      itemArrastado.Data_Hora = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16).replace("T", " ");
  } else {
      // Se tiverem horas diferentes, simplesmente invertemos as horas das duas!
      itemArrastado.Data_Hora = tempoB;
      itemAlvo.Data_Hora = tempoA;
  }

  // 4. Atualiza o ecrã instantaneamente para dar a sensação de fluidez
  UI_renderizarRoteiro();
  if (typeof UI_vibrar === 'function') UI_vibrar(30);

  // 5. Salva silenciosamente na base de dados (Sem bloquear o utilizador)
  google.script.run.withFailureHandler(err => console.error("Erro D&D:", err)).Viagens_salvarRegistro(itemArrastado, []);
  
  // Só salva a nota alvo se ela também sofreu alteração na hora
  if (tempoA !== tempoB) {
      google.script.run.withFailureHandler(err => console.error("Erro D&D:", err)).Viagens_salvarRegistro(itemAlvo, []);
  }
}




// =======================================================
// 🔄 MÓDULO: 13_Js_Trocar.html (LÓGICA E CADASTRO)
// =======================================================

function MenuTopo_abrir() {
  if (typeof UI_vibrar === 'function') UI_vibrar(20);

  // 🛡️ MÁGICA DE UX: Usamos o SweetAlert para construir a interface dinamicamente e furar qualquer bloqueio do ecrã!
  let botoesHtml = '';

  if (!ESTADO_APP || !ESTADO_APP.config || !Array.isArray(ESTADO_APP.config.viagens) || ESTADO_APP.config.viagens.length === 0) {
    botoesHtml = '<div class="text-muted text-center p-3 mb-3">Nenhuma viagem cadastrada.</div>';
  } else {
    ESTADO_APP.config.viagens.forEach(viagem => {
      const isAtual = (viagem === ESTADO_APP.viagemAtual);
      const corFundo = isAtual ? 'var(--accent)' : '#f8f9fa';
      const corTexto = isAtual ? '#fff' : 'var(--primary)';
      const icone = isAtual ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-plane"></i>';
      const viagemSegura = String(viagem).replace(/'/g, "\\'");

      botoesHtml += `
        <button onclick="MenuTopo_selecionar('${viagemSegura}')" class="btn shadow-sm" style="background: ${corFundo}; color: ${corTexto}; border: 1px solid #eee; border-radius: 12px; padding: 15px; margin-bottom: 10px; font-weight: 800; display: flex; justify-content: space-between; align-items: center; text-align: left; width: 100%; transition: 0.2s;">
          <span>${viagem}</span>
          ${icone}
        </button>
      `;
    });
  }

  // Adicionamos os botões extra no final da lista
  botoesHtml += `
    <hr style="border-top: 1px dashed #ccc; margin: 15px 0;">
    <button onclick="MenuTopo_criarNovaViagem()" class="btn w-100" style="background: rgba(44, 62, 80, 0.05); color: var(--primary); border: 2px dashed var(--primary); border-radius: 12px; padding: 15px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 10px;">
      <i class="fas fa-plus-circle"></i> CRIAR NOVA VIAGEM
    </button>
    <a href="https://script.google.com/macros/s/AKfycbztcey1mskuqF9RqzorHDdlGnYr5Y_U7i264VFk16nIbGUdEVC253Cu_dbrgrDQEzryBA/exec" class="btn w-100 mt-2" style="background: #fff; color: var(--primary); border: 1px solid #ddd; border-radius: 12px; font-weight: 800; padding: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none;">
      <i class="fas fa-wallet text-primary"></i> Voltar ao App Financeiro
    </a>
  `;

  // Invoca o modal mágico
  Swal.fire({
    title: '<div style="font-weight: 800; color: var(--primary); font-size: 1.2rem; text-align: left;"><i class="fas fa-compass text-accent me-2"></i> Suas Viagens</div>',
    html: `<div style="margin-top: 15px; max-height: 50vh; overflow-y: auto; padding-right: 5px;">${botoesHtml}</div>`,
    showConfirmButton: false,
    showCloseButton: true,
    padding: '1.5em',
    customClass: { popup: 'rounded-4' }
  });
}

function MenuTopo_fechar() {
  Swal.close();
}

function MenuTopo_selecionar(nomeViagem) {
  ESTADO_APP.viagemAtual = nomeViagem;
  localStorage.setItem('VIAGEM_ATIVA', nomeViagem);
  MenuTopo_fechar();
  
  if (typeof UI_renderizarInterface === 'function') UI_renderizarInterface();
}

function MenuTopo_criarNovaViagem() {
  MenuTopo_fechar(); 
  
  Swal.fire({
    title: 'Nova Viagem',
    text: 'Dê um nome para a sua aventura (Ex: Paris 2026)',
    input: 'text',
    inputPlaceholder: 'Nome da Viagem',
    showCancelButton: true,
    confirmButtonText: 'Criar e Acessar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: 'var(--accent)'
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const nomeDigitado = result.value.trim();
      const viagensSalvas = (ESTADO_APP && ESTADO_APP.config && Array.isArray(ESTADO_APP.config.viagens)) ? ESTADO_APP.config.viagens : [];
      
      if (viagensSalvas.includes(nomeDigitado)) {
        Swal.fire('Opa!', 'Já existe uma viagem com esse nome.', 'warning');
        return;
      }
      
      Swal.fire({ title: 'Criando viagem...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

      google.script.run
        .withSuccessHandler(() => {
          ESTADO_APP.viagemAtual = nomeDigitado;
          localStorage.setItem('VIAGEM_ATIVA', nomeDigitado);
  
          Swal.fire({ title: 'Malas prontas! ✈️', text: 'Viagem criada com sucesso.', icon: 'success', timer: 2000, showConfirmButton: false });
          if (typeof Api_buscarDados === 'function') Api_buscarDados(false);
        })
        .withFailureHandler(err => {
          Swal.fire('Erro', err.message, 'error');
        })
        .Viagens_criarNovaViagem(nomeDigitado);
    }
  });
}


// =======================================================
// 💳 MÓDULO: 15_Js_Gasto.html (LÓGICA DE DESPESAS)
// =======================================================

// 🌟 FUNÇÃO ATUALIZADA: Suporta agrupamento <optgroup> e Abertura Contextual
function Gasto_abrirModal(atividadeVinculada = null) {
  document.body.classList.remove('speed-dial-open');
  document.getElementById('form-novo-gasto').reset();
  
  // Limpa Edição
  document.getElementById('gasto-id').value = "";
  document.getElementById('titulo-modal-gasto').innerHTML = '<i class="fas fa-receipt me-2"></i>Novo Gasto';
  App_FecharTela('btn-excluir-gasto');

  document.getElementById('gasto-data').value = new Date().toISOString().split('T')[0];

  const selCat = document.getElementById('gasto-categoria');
  selCat.innerHTML = '<option value="">Selecione...</option>';
  if (ESTADO_APP.config.categoriasRoteiro) {
    ESTADO_APP.config.categoriasRoteiro.forEach(c => selCat.innerHTML += `<option value="${c}">${c}</option>`);
  }

  // 🌟 NOVO: Lógica de Agrupamento Visual do Select
  const selVinculo = document.getElementById('gasto-vinculo');
  selVinculo.innerHTML = '<option value="">Gasto Avulso (Nenhuma)</option>';
  
  const atividades = ESTADO_APP.dadosBD.filter(i => i['Viagem'] === ESTADO_APP.viagemAtual && i['Tipo_Registro'] === 'Atividade');

  // 1. Separar as atividades pelas suas datas
  const gruposPorData = {};
  atividades.forEach(ativ => {
    const dataOriginal = ativ['Data_Hora'] ? ativ['Data_Hora'].split(' ')[0] : 'Sem Data';
    if (!gruposPorData[dataOriginal]) gruposPorData[dataOriginal] = [];
    gruposPorData[dataOriginal].push(ativ);
  });

  // 2. Criar os <optgroup> ordenados cronologicamente
  Object.keys(gruposPorData).sort().forEach(data => {
    // Formata a data para o cabeçalho (ex: 23/07/2026)
    let dataFormatada = 'Sem Data';
    if (data !== 'Sem Data') {
      const partes = data.split('-');
      dataFormatada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : data;
    }

    // Cria o grupo
    let optgroup = document.createElement('optgroup');
    optgroup.label = `📅 ${dataFormatada}`;

    // Adiciona as atividades (agora sem a data no texto, pois já está no grupo)
    gruposPorData[data].forEach(ativ => {
      let option = document.createElement('option');
      option.value = ativ['Titulo_Descricao'];
      option.text = ativ['Titulo_Descricao'];
      optgroup.appendChild(option);
    });

    selVinculo.appendChild(optgroup);
  });

  // 🌟 NOVO: Se o utilizador clicou no card, seleciona automaticamente!
  if (atividadeVinculada) {
    selVinculo.value = atividadeVinculada;
  }

  Gasto_verificarVinculo();
  App_AbrirTela('modal-gasto', 'flex');
}

// 🌟 NOVA FUNÇÃO: CARREGAR DADOS PARA EDIÇÃO
function Gasto_editarGasto(id) {
  const item = ESTADO_APP.dadosBD.find(i => String(i.ID) === String(id));
  if (!item) return;

  Gasto_abrirModal(); // Abre e carrega os selectores
  
  document.getElementById('titulo-modal-gasto').innerHTML = '<i class="fas fa-edit me-2"></i>Editar Gasto';
  App_AbrirTela('btn-excluir-gasto', 'block');

  document.getElementById('gasto-id').value = item.ID;
  document.getElementById('gasto-descricao').value = item.Titulo_Descricao;
  
  if (item.Data_Hora) document.getElementById('gasto-data').value = item.Data_Hora.split(' ')[0];
  
  document.getElementById('gasto-valor').value = parseFloat(String(item.Valor).replace(',', '.')).toLocaleString('pt-BR', {minimumFractionDigits: 2});

  // Dá um tempo curto para o JavaScript popular os selects
  setTimeout(() => {
    document.getElementById('gasto-categoria').value = item.Categoria;
    document.getElementById('gasto-vinculo').value = item.Atividade_Vinculada || "";
    Gasto_verificarVinculo();
  }, 50);
}

function Gasto_fecharModal() {
  App_FecharTela('modal-gasto');
}

function Gasto_verificarVinculo() {
  const vinculo = document.getElementById('gasto-vinculo').value;
  const containerData = document.getElementById('container-gasto-data');
  containerData.style.display = vinculo ? 'none' : 'block';
}

function Gasto_mascararValor(input) {
  let v = input.value.replace(/\D/g, ""); 
  if (v === "") { input.value = ""; return; }
  v = (parseInt(v) / 100).toFixed(2).replace(".", ",");
  v = v.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  input.value = v;
}

/**
 * 🚀 Gasto_salvar (VERSÃO PWA NATIVA / LOCAL-FIRST)
 * Estabilizada: UI imediata e integração nativa com o Proxy de Sincronização.
 * * OBJETIVO: Garantir que o app funcione sem internet, salvando no aparelho
 * primeiro e sincronizando com o Google Sheets depois.
 */
function Gasto_salvar() {
  // --- 1. COLETA DE DADOS DO FORMULÁRIO ---
  const valorStr = document.getElementById('gasto-valor').value;
  const descricao = document.getElementById('gasto-descricao').value.trim();
  const categoria = document.getElementById('gasto-categoria').value;
  const vinculoSelecionado = document.getElementById('gasto-vinculo').value;
  const idEdicao = document.getElementById('gasto-id').value;

  // --- 2. VALIDAÇÃO DE SEGURANÇA ---
  if (!valorStr || !descricao || !categoria) {
    return Swal.fire({
      title: 'Opa!',
      text: 'Preencha o Valor, a Descrição e a Categoria.',
      icon: 'warning',
      confirmButtonColor: 'var(--accent)'
    });
  }

  // --- 3. TRATAMENTO MATEMÁTICO ---
  // Converte "1.250,50" para 1250.50 para cálculos corretos
  const valorMatematico = parseFloat(valorStr.replace(/\./g, "").replace(",", ".")) || 0;

  // Lógica para herdar a data da atividade (ex: Hotel) se o gasto estiver vinculado a ela
  let dataFinal = document.getElementById('gasto-data').value;
  if (vinculoSelecionado) {
    const atividadePai = ESTADO_APP.dadosBD.find(i => 
      i['Viagem'] === ESTADO_APP.viagemAtual && 
      i['Tipo_Registro'] === 'Atividade' && 
      i['Titulo_Descricao'] === vinculoSelecionado
    );
    if (atividadePai && atividadePai['Data_Hora']) dataFinal = atividadePai['Data_Hora'].split(' ')[0];
  }

  // --- 4. PREPARAÇÃO DO OBJETO (PAYLOAD) ---
  const isNovo = (!idEdicao || idEdicao === '');
  const idFinal = isNovo ? 'temp_gasto_' + new Date().getTime() : idEdicao;

  const payload = {
    ID: idFinal,
    Viagem: ESTADO_APP.viagemAtual, 
    Tipo_Registro: 'Gasto', 
    Status: 'Gasto Local', 
    Data_Hora: dataFinal, 
    Titulo_Descricao: descricao, 
    Categoria: categoria, 
    Valor: valorMatematico, 
    Atividade_Vinculada: vinculoSelecionado, 
    Usuario: "Admin",
    Integridade: 'Pendente' // Define que este dado ainda não foi confirmado pela nuvem
  };

  // --- 🛡️ PASSO 1: OPTIMISTIC UI (ATUALIZAÇÃO IMEDIATA) ---
  // Injeta o dado na memória RAM do app antes de qualquer resposta do servidor
  if (isNovo) {
    ESTADO_APP.dadosBD.push(payload);
  } else {
    const index = ESTADO_APP.dadosBD.findIndex(i => String(i.ID) === String(idFinal));
    if (index > -1) ESTADO_APP.dadosBD[index] = payload;
  }

  // --- 🛡️ PASSO 2: PERSISTÊNCIA EM CACHE LOCAL ---
  // Grava no armazenamento físico do telemóvel para não perder dados se o PWA for fechado
  localStorage.setItem('DADOS_VIAGEM_CACHE', JSON.stringify(ESTADO_APP.dadosBD));

  // --- 🛡️ PASSO 3: LIMPEZA DA INTERFACE ---
  // Fecha o formulário e redesenha a lista de gastos na hora
  Gasto_fecharModal();
  if (typeof UI_renderizarGastos === 'function') UI_renderizarGastos(); 
  if (typeof UI_renderizarRoteiro === 'function') UI_renderizarRoteiro();

  // --- 🛡️ PASSO 4: FEEDBACK AO UTILIZADOR ---
  Swal.fire({ 
    title: 'Salvo localmente!', 
    icon: 'success', 
    toast: true, 
    position: 'top-end', 
    timer: 1500, 
    showConfirmButton: false 
  });
  if (typeof UI_vibrar === 'function') UI_vibrar(20);

  // --- 🛡️ PASSO 5: SINCRONIZAÇÃO ASSÍNCRONA (BACKGROUND) ---
  // O Proxy Tradutor (20_Ferramentas_Dev) interceta isto se estiveres offline
  google.script.run
    .withSuccessHandler(() => {
       console.log("✅ Sincronizado com o servidor!");
       // Recarrega os dados em silêncio para limpar as marcas de 'Pendente'
       Api_buscarDados(true); 
    })
    .withFailureHandler(err => {
       console.warn("⚠️ Modo Offline: Ação guardada na fila de espera automática.");
    })
    .Viagens_salvarRegistro(payload, []);
}



/**
 * 🚀 Gasto_excluirGasto (VERSÃO LOCAL-FIRST)
 */
function Gasto_excluirGasto() {
  const id = document.getElementById('gasto-id').value;
  if (!id) return;

  Swal.fire({
    title: 'Excluir Gasto?', text: "O valor será removido do seu orçamento.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      
      // 🌟 PASSO 1: OPTIMISTIC UI - Remove localmente primeiro
      ESTADO_APP.dadosBD = ESTADO_APP.dadosBD.filter(i => String(i.ID) !== String(id));
      localStorage.setItem('DADOS_VIAGEM_CACHE', JSON.stringify(ESTADO_APP.dadosBD));

      // 🌟 PASSO 2: Fecha o ecrã instantaneamente e re-renderiza
      Gasto_fecharModal(); 
      if (typeof UI_renderizarGastos === 'function') UI_renderizarGastos(); 
      if (typeof UI_renderizarRoteiro === 'function') UI_renderizarRoteiro();

      // 🌟 PASSO 3: Feedback Imediato
      Swal.fire({ title: 'Excluído!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
      if (typeof UI_vibrar === 'function') UI_vibrar(20);

      // 🌟 PASSO 4: Envia a ação de exclusão para o Proxy Mágico
      google.script.run
        .withSuccessHandler(() => {
          Api_buscarDados(true); // Confirma silenciosamente se estiver online
        })
        .withFailureHandler(err => {
          console.log("Sem internet. Exclusão guardada na fila offline.");
        })
        .Viagens_excluirRegistro(id);
    }
  });
}


// =======================================================
// ✅ MÓDULO: 17_Js_Checklist.html (LÓGICA E MÚLTIPLOS ITENS)
// =======================================================

// 🌟 Variável global para armazenar os itens temporários
let CHECKLIST_TEMP = [];

function Checklist_abrirModal() {
  document.body.classList.remove('speed-dial-open');
  document.getElementById('form-novo-checklist').reset();
  
  // Limpa a lista temporária
  CHECKLIST_TEMP = [];
  Checklist_renderizarTemp();
  
  const selCat = document.getElementById('check-categoria');
  selCat.innerHTML = '<option value="">Selecione...</option>';
  
  if (ESTADO_APP.config.categoriasChecklist && ESTADO_APP.config.categoriasChecklist.length > 0) {
    ESTADO_APP.config.categoriasChecklist.forEach(c => {
       selCat.innerHTML += `<option value="${c}">${c}</option>`;
    });
  } else {
    selCat.innerHTML += `<option value="Geral">Geral (Cadastre na planilha)</option>`;
  }

  App_AbrirTela('modal-checklist', 'flex');
}

function Checklist_fecharModal() {
  App_FecharTela('modal-checklist');
}

// 🌟 Adiciona item à lista temporária (Carrinho)
function Checklist_adicionarTemp() {
  const titulo = document.getElementById('check-titulo').value.trim();
  const categoria = document.getElementById('check-categoria').value;

  if (!categoria) {
    Swal.fire('Opa!', 'Escolha uma categoria primeiro.', 'warning');
    return;
  }
  if (!titulo) return; // Se o texto estiver vazio, ignora silenciosamente

  // Guarda o objeto na lista
  CHECKLIST_TEMP.push({ titulo: titulo, categoria: categoria });
  
  // Limpa o input e devolve o foco para digitar rapidamente
  document.getElementById('check-titulo').value = '';
  document.getElementById('check-titulo').focus();
  
  Checklist_renderizarTemp();
  if (typeof UI_vibrar === 'function') UI_vibrar(20);
}

// 🌟 Remove um item específico da lista temporária
function Checklist_removerTemp(index) {
  CHECKLIST_TEMP.splice(index, 1);
  Checklist_renderizarTemp();
  if (typeof UI_vibrar === 'function') UI_vibrar(20);
}

// 🌟 Renderiza o HTML da lista temporária
function Checklist_renderizarTemp() {
  const container = document.getElementById('lista-checklist-temp');
  container.innerHTML = '';
  
  CHECKLIST_TEMP.forEach((item, index) => {
    container.innerHTML += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#f8f9fa; padding:8px 12px; border-radius:8px; border:1px solid #eee;">
        <div>
          <span style="font-weight: 800; color: var(--primary); display:block; font-size: 0.85rem;">${item.titulo}</span>
          <span style="font-size: 0.65rem; color: var(--secondary); text-transform:uppercase;">${item.categoria}</span>
        </div>
        <button type="button" style="background:transparent; border:none; color:var(--danger); padding:5px;" onclick="Checklist_removerTemp(${index})">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  });
}

async function Checklist_salvar() {
  const tituloPendente = document.getElementById('check-titulo').value.trim();
  if (tituloPendente) {
    Checklist_adicionarTemp();
  }

  if (CHECKLIST_TEMP.length === 0) {
    return Swal.fire('Opa!', 'Adicione pelo menos um item para salvar.', 'warning');
  }

  // 🌟 MENTORIA: Liberta o ecrã imediatamente sem pop-ups bloqueantes
  Checklist_fecharModal();

  let itensConcluidos = 0;

  for (const item of CHECKLIST_TEMP) {
    const payload = {
      Viagem: ESTADO_APP.viagemAtual, Tipo_Registro: 'Checklist', Status: 'Pendente', Titulo_Descricao: item.titulo, Categoria: item.categoria, Data_Hora: "", Valor: 0, Localizacao: "", Anotacoes: "", Usuario: "Admin"
    };

    try {
      await new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .Viagens_salvarRegistro(payload, []);
      });
      itensConcluidos++;
    } catch (err) {
      console.error(`Erro ao salvar '${item.titulo}':`, err);
    }
  }

  if (itensConcluidos > 0) {
    Swal.fire({ title: 'Pronto!', text: `${itensConcluidos} itens guardados.`, icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
  } else {
    Swal.fire('Erro', 'Não foi possível salvar os itens.', 'error');
  }
  
  Api_buscarDados(true);
}

// 🛡️ A MÁGICA DE MARCAR O "OK" (Mantida intacta)
function Checklist_alternarStatus(id, statusAtual) {
  const novoStatus = statusAtual === 'Concluído' ? 'Pendente' : 'Concluído';
  
  if (novoStatus === 'Concluído') {
    UI_vibrar(60);
  } else {
    UI_vibrar(20);
  }
  
  const index = ESTADO_APP.dadosBD.findIndex(i => String(i.ID) === String(id));
  if (index > -1) {
    ESTADO_APP.dadosBD[index].Status = novoStatus;
    UI_renderizarChecklist();
  }

  google.script.run.withFailureHandler(err => {
    Swal.fire('Erro de Sincronização', 'Não foi possível salvar o check.', 'warning');
    Api_buscarDados(true); 
  }).Viagens_toggleChecklist(id, novoStatus);
}

function Checklist_excluirItem(id, event) {
  if (event) event.stopPropagation();

  Swal.fire({
    title: 'Excluir item?', text: "Deseja remover este item da sua mala?", icon: 'warning', showCancelButton: true, confirmButtonColor: '#e74c3c', cancelButtonText: 'Cancelar', confirmButtonText: 'Sim, excluir!'
  }).then((result) => {
    if (result.isConfirmed) {
      // 🌟 Remoção direta sem a janela "Limpando da mala..."
      google.script.run
        .withSuccessHandler(res => {
          Swal.fire({ title: 'Excluído!', icon: 'success', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
          Api_buscarDados(true);
        })
        .withFailureHandler(err => {
          Swal.fire('Erro', err.message, 'error');
        })
        .Viagens_excluirRegistro(id);
    }
  });
}


// =======================================================
// 🗺️ MÓDULO: 19_Js_Mapa.html (LÓGICA E GOOGLE MAPS)
// =======================================================

let mapaGoogle;
let mapaMarkers = [];
let mapaPolyline;
let geocoder;

function Mapa_abrirTela() {
  if (!mapaGoogle && typeof google !== 'undefined' && google.maps) {
    mapaGoogle = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }]
    });
    geocoder = new google.maps.Geocoder();
  }
  Mapa_renderizarDias();
}

function Mapa_renderizarDias() {
  const atividades = ESTADO_APP.dadosBD.filter(i => i['Viagem'] === ESTADO_APP.viagemAtual && i['Tipo_Registro'] === 'Atividade');
  const diasMap = {};
  atividades.forEach(ativ => {
    if(ativ.Data_Hora) {
      const dia = ativ.Data_Hora.split(' ')[0];
      if(!diasMap[dia]) diasMap[dia] = [];
      diasMap[dia].push(ativ);
    }
  });

  const diasOrdenados = Object.keys(diasMap).sort();
  const carrossel = document.getElementById('mapa-carrossel-dias');
  carrossel.innerHTML = '';

  if(diasOrdenados.length === 0) {
    carrossel.innerHTML = '<div style="padding: 10px 20px; background: white; border-radius: 20px; font-weight: bold; color: #95a5a6; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">Nenhum endereço com data encontrado.</div>';
    return;
  }

  diasOrdenados.forEach((dia, index) => {
    const partes = dia.split('-');
    const label = `${partes[2]}/${partes[1]}`;
    carrossel.innerHTML += `<button onclick="Mapa_carregarDia('${dia}')" id="btn-dia-${dia}" class="btn-mapa-dia" style="padding: 8px 16px; background: white; border: none; border-radius: 20px; font-weight: 800; color: #bdc3c7; box-shadow: 0 2px 5px rgba(0,0,0,0.05); cursor: pointer; transition: 0.3s;">Dia ${index+1} (${label})</button>`;
  });

  Mapa_carregarDia(diasOrdenados[0]);
}

function Mapa_carregarDia(diaSelecionado) {
  document.querySelectorAll('.btn-mapa-dia').forEach(b => {
     b.style.color = '#bdc3c7'; b.style.border = 'none';
  });
  
  const btnAtivo = document.getElementById('btn-dia-' + diaSelecionado);
  if (btnAtivo) {
     btnAtivo.style.color = 'var(--accent)';
     btnAtivo.style.border = '2px solid var(--accent)';
  }

  const atividades = ESTADO_APP.dadosBD.filter(i => i['Viagem'] === ESTADO_APP.viagemAtual && i['Tipo_Registro'] === 'Atividade' && i.Data_Hora && i.Data_Hora.startsWith(diaSelecionado));
  atividades.sort((a,b) => a.Data_Hora.localeCompare(b.Data_Hora));

  mapaMarkers.forEach(m => m.setMap(null));
  mapaMarkers = [];
  if(mapaPolyline) mapaPolyline.setMap(null);
  Mapa_fecharBottomSheet();

  if (!geocoder || atividades.length === 0) return;

  const bounds = new google.maps.LatLngBounds();
  const coordenadasRota = new Array(atividades.length); 
  
  let processados = 0;
  const totalAtividades = atividades.length; 

  atividades.forEach((ativ, index) => {
    let endereco = ativ.Enderecos ? ativ.Enderecos.split(' | ')[0].trim() : null;
    
    if(endereco && endereco !== '') {
      let isUrl = endereco.toLowerCase().startsWith('http');
      
      // 🌟 NOVA LÓGICA: Tentar extrair coordenadas geográficas diretamente de dentro do link!
      let latLngExtraido = null;
      if (isUrl) {
        // Tenta encontrar padrões comuns de coordenadas nos links do Maps (ex: @-12.97,-38.50 ou query=-12.97,-38.50)
        const regexCoord = /@(-?\d+\.\d+),(-?\d+\.\d+)|query=(-?\d+\.\d+),(-?\d+\.\d+)/;
        const match = endereco.match(regexCoord);
        if (match) {
          const lat = parseFloat(match[1] || match[3]);
          const lng = parseFloat(match[2] || match[4]);
          if (!isNaN(lat) && !isNaN(lng)) latLngExtraido = { lat: lat, lng: lng };
        }
      }

      if (latLngExtraido) {
        // 🎉 Sucesso: Extraiu as coordenadas do link! Desenha o pino diretamente.
        coordenadasRota[index] = latLngExtraido;
        criarPinoEAvancar(latLngExtraido, ativ, index, bounds);
      } else {
        // Se for um link curto (goo.gl) ou um endereço em texto, tenta procurar no Google
        let queryBusca = isUrl ? ativ.Titulo_Descricao : endereco;
        
        geocoder.geocode({ address: queryBusca }, (results, status) => {
          if(status === 'OK') {
            const loc = results[0].geometry.location;
            coordenadasRota[index] = loc;
            criarPinoEAvancar(loc, ativ, index, bounds);
          } else {
            console.warn("⚠️ Maps não encontrou a localização para: " + queryBusca);
            avancarProcessamento();
          }
        });
      }
    } else {
       avancarProcessamento();
    }
  });

  // --- Funções Auxiliares Internas para manter o código organizado ---
  function criarPinoEAvancar(loc, ativ, index, limites) {
    const marker = new google.maps.Marker({
      map: mapaGoogle, 
      position: loc,
      label: { text: String(index + 1), color: "white", fontSize: "14px", fontWeight: "bold" },
      title: ativ.Titulo_Descricao,
      animation: google.maps.Animation.DROP
    });
    
    mapaMarkers.push(marker);
    limites.extend(loc);
    
    marker.addListener('click', () => {
       mapaGoogle.panTo(loc);
       Mapa_abrirBottomSheet(ativ, loc);
    });
    avancarProcessamento();
  }

  function avancarProcessamento() {
    processados++;
    // Só centraliza e desenha a linha quando TODOS os itens do ciclo terminarem
    if(processados === totalAtividades && mapaMarkers.length > 0) {
      Mapa_finalizarDesenhoRota(bounds, coordenadasRota);
    }
  }
}

function Mapa_finalizarDesenhoRota(bounds, coordenadasRota) {
   if(mapaMarkers.length > 0) {
      mapaGoogle.fitBounds(bounds);
      const listener = google.maps.event.addListener(mapaGoogle, "idle", function() { 
        if (mapaGoogle.getZoom() > 16) mapaGoogle.setZoom(16); 
        google.maps.event.removeListener(listener); 
      });
   }

   const pathValid = coordenadasRota.filter(c => c != null);
   if(pathValid.length > 1) {
      mapaPolyline = new google.maps.Polyline({
        path: pathValid,
        geodesic: true, strokeColor: '#3498db', strokeOpacity: 0.8, strokeWeight: 4,
        icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW }, offset: '50%' }]
      });
      mapaPolyline.setMap(mapaGoogle);
   }
}

function Mapa_abrirBottomSheet(ativ, loc) {
  document.getElementById('sheet-categoria').innerText = ativ.Categoria || 'Geral';
  document.getElementById('sheet-titulo').innerText = ativ.Titulo_Descricao;
  
  let horaIn = ativ.Data_Hora ? ativ.Data_Hora.split(' ')[1] || '' : '';
  let horaFim = ativ.Data_Hora_Fim ? ativ.Data_Hora_Fim.split(' ')[1] || '' : '';
  document.getElementById('sheet-horario').innerHTML = `<i class="far fa-clock"></i> ${horaIn} ${horaFim ? 'até ' + horaFim : ''}`;

  let enderecoBase = ativ.Enderecos ? ativ.Enderecos.split(' | ')[0].trim() : '';
  let isUrl = enderecoBase.toLowerCase().startsWith('http');
  
  // Link seguro para o botão do Google Maps
  let hrefMaps = isUrl ? enderecoBase : 'https://maps.google.com/?q=' + encodeURIComponent(enderecoBase);
  
  // 🌟 CORREÇÃO: Lógica inteligente que aceita tanto objetos do Google como objetos simples
  let lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  let lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  
  let tituloEnc = encodeURIComponent(ativ.Titulo_Descricao);
  let endEnc = encodeURIComponent(enderecoBase);

  // Usando concatenação simples de string para evitar erros de sintaxe ao colar o código
  let hrefUber = "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=" + lat + "&dropoff[longitude]=" + lng + "&dropoff[nickname]=" + tituloEnc;
  
  if (!isUrl && enderecoBase !== '') {
    hrefUber += "&dropoff[formatted_address]=" + endEnc;
  }

  document.getElementById('sheet-btn-maps').href = hrefMaps;
  document.getElementById('sheet-btn-uber').href = hrefUber;
  
  document.getElementById('mapa-bottom-sheet').style.bottom = '0';
}

function Mapa_fecharBottomSheet() {
  document.getElementById('mapa-bottom-sheet').style.bottom = '-100%';
}

function Mapa_centralizarUsuario() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
        new google.maps.Marker({
           position: pos, map: mapaGoogle,
           icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#4285F4', fillOpacity: 1, strokeWeight: 2, strokeColor: 'white' }
        });
        mapaGoogle.panTo(pos);
        mapaGoogle.setZoom(15);
      },
      () => Swal.fire('Localização', 'Ative o GPS do seu dispositivo.', 'warning')
    );
  }
}


/**
 * 🛑 MOTOR DE SINCRONIZAÇÃO MANUAL E OFFLINE-FIRST
 * Arquivo: 21_Js_SyncAPP.html
 * Regra: NADA vai para a nuvem automaticamente. Tudo fica na fila até o usuário mandar.
 */

const SYNC_QUEUE_KEY = 'VIAGENS_MANUAL_QUEUE';

// 1. ATUALIZA A INTERFACE VISUAL DO BOTÃO
function SyncAPP_atualizarInterface() {
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');
  const indicador = document.getElementById('sync-indicator');
  
  if (!icon || !text) return;

  let filaAtual = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
  
  // Transformar o indicador num botão clicável
  if (indicador) {
    indicador.style.cursor = 'pointer';
    indicador.onclick = SyncAPP_DispararSincronismo; // Clicar = Sincronizar
  }

  if (filaAtual.length > 0) {
    icon.className = 'fas fa-cloud-upload-alt text-warning';
    text.innerText = `Sincronizar (${filaAtual.length})`;
    text.style.color = '#f39c12';
  } else {
    icon.className = 'fas fa-cloud text-success';
    text.innerText = 'App Atualizado';
    text.style.color = '#27ae60';
  }
}

// 2. FUNÇÃO ACIONADA PELO CLIQUE DO UTILIZADOR
async function SyncAPP_DispararSincronismo() {
  let filaAtual = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
  
  if (filaAtual.length === 0) {
    if(typeof Swal !== 'undefined') Swal.fire('Tudo em dia!', 'Não há alterações pendentes para enviar.', 'info');
    return;
  }

  if (!navigator.onLine) {
    if(typeof Swal !== 'undefined') Swal.fire('Sem Internet', 'Precisas de conexão para sincronizar os dados guardados.', 'error');
    return;
  }

  // Se a função do PWA estiver disponível, chama-a
  if (typeof window.App_ProcessarFilaManual === 'function') {
    window.App_ProcessarFilaManual();
  }
}

// Atualiza a interface ao carregar a página
document.addEventListener("DOMContentLoaded", SyncAPP_atualizarInterface);

