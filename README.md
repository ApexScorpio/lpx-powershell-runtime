# LPX PowerShell Bridge

RepositÃ³rio pÃºblico da PowerShell Bridge v15 Lite.

## Objetivo

- Guardar resultados sanitizados de jobs PowerShell na branch untime.
- Guardar apenas conhecimento tÃ©cnico consolidado na branch main.
- NÃ£o guardar comandos PowerShell completos no GitHub.
- Permitir vÃ¡rias conversas do ChatGPT em paralelo, uma por aba.

## SeguranÃ§a

Tokens, credenciais, segredos OAuth e caminhos de utilizador sÃ£o removidos antes da publicaÃ§Ã£o.

## Ficheiros principais

- knowledge/CURRENT_STATE.md
- knowledge/LESSONS.md
- knowledge/DECISIONS.md
- knowledge/KNOWN_ISSUES.md
- 	ampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
"@

 = @"
# Estado atual

- Bridge: v15 Lite
- Protocolo: 15
- URL local: http://127.0.0.1:17351
- ConcorrÃªncia: atÃ© 8 jobs
- Browser: Tampermonkey v15 Lite event-driven
- Resultados: branch runtime, histÃ³rico reescrito
- Comandos completos: temporÃ¡rios e locais; nÃ£o publicados
- Multi-conversa: suportada por tabId + conversationId
- RepositÃ³rio pÃºblico: ApexScorpio/lpx-powershell-runtime
- Atualizado: 2026-07-29 11:53:31 +01:00