# LPX PowerShell Bridge — Histórico de fiabilidade (2026-10-30)

Registo cumulativo: não substituir nem remover as entradas anteriores.

## 2026-10-30 — Passo 1: Inspeção em modo leitura
- Consultado userscript público da branch main com versão 15.5.12 e respetivos metadados.
- Identificado envio de mensagens com até 30 tentativas e combinação de cliques sintéticos, click, requestSubmit e Enter.
- A função de envio terminava com sucesso mesmo se o texto continuava no compositor.
- Detetados claim TTL de 120 segundos, possibilidade de outro separador assumir um job ao fim de 30 segundos, e perda de acompanhamento após erro HTTP/timeout.
- Identificada a marcação do job como tratado antes da confirmação do envio do resultado.

## 2026-10-30 — Passo 2: Correção isolada
- Criada branch fix/bridge-delivery-recovery-20261030 sem substituir a versão main.
- Versão candidata 15.5.13.
- Substituídas tentativas repetidas por um único clique nativo no botão ativo, com confirmação de mensagem de utilizador no histórico.
- Bloqueada substituição de rascunhos alheios e manipulação forçada de botões desativados.
- Inserção de texto ProseMirror tentada via execCommand('insertText') para envolver o mecanismo nativo de edição do navegador.
- Introduzido registo persistente inflight por conversa, guardado antes da submissão ao serviço local.
- Restabelecimento do acompanhamento via GET de job existente sem novo POST e monitorização tolerante a falhas temporárias de rede.
- Resultado assinalado como tratado apenas depois de confirmação de envio ao ChatGPT.
- Claims alargados para 10 minutos e renovados durante monitorização.
- Quando um envio ou job fica incerto, conserva-se a referência e não se reexecuta cegamente.

## 2026-10-30 — Passo 3: Validação limitada
- Compilação sintática JavaScript via new Function: PASS.
- Quatro testes lógicos isolados: rascunho preexistente preservado, botão desativado não clicado, um clique para envio confirmado, um clique para envio não confirmado.
- Resultado: 4 PASS, 0 FAIL.
- Sem acesso ao Chrome real do utilizador nem aos logs do daemon; testes de integração reais ainda pendentes.
- Não foram fechadas aplicações, modificadas sessões ou eliminados tokens.
- Não foi possível recolher screenshot do Chrome do utilizador; validação visual só possível por execução local.

## 2026-10-30 — Riscos e próximos testes
- Confirmar DOM e comportamento da versão do ChatGPT instalada no Chrome, sobretudo inserção multi-linha em ProseMirror.
- Confirmar semântica do endpoint /job em caso de timeout, HTTP 404 e expiração real do lado servidor.
- Confirmar processo de atualização do Tampermonkey da versão 15.5.11.
- Não apresentar a correção como testada no Windows até receber evidência real.

## 2026-10-30 — Passo 4: Proteção da deteção e revisão de compatibilidade
- A observação de alterações ignora mutações alheias às respostas do assistente, para impedir que alterações contínuas no compositor adiem a deteção de jobs.
- A monitorização também acompanha jobs iniciados manualmente através do painel, mesmo quando a autonomia não está ativa.
- Sintaxe novamente validada com sucesso.
- Consultada documentação MDN: document.execCommand('insertText') é uma API antiga, com comportamento dependente do navegador e que exige validação no Chrome real.
- A correção não pressupõe que esta API funcione em todas as versões do ChatGPT; uma falha mantém o envio como não confirmado.

## 2026-10-30 — Passo 5: Publicação da versão
- PR #1 criada e integrada na branch main.
- Commit de integração: 8ae2b8edcfb9122c5d135b60b001092b79722d11.
- Versão publicada em main: 15.5.13; revisão de leitura confirmada após integração.
- A publicação não equivale a instalação automática imediata no Chrome do utilizador.
- A verificação de serviço local, daemon, logs e screenshots do utilizador continua necessária para encerrar o incidente.
