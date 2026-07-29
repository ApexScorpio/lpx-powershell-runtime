# LiÃ§Ãµes tÃ©cnicas

Este ficheiro guarda apenas causas confirmadas, tentativas que falharam, soluÃ§Ãµes validadas e regras permanentes.

## PSB-001 â€” Compatibilidade com a saÃ­da chunk

- Estado: resolvido e validado
- Sintoma: os comandos terminavam, mas o ChatGPT recebia (o comando nÃ£o devolveu texto).
- Causa: a bridge expunha a saÃ­da acumulada no campo chunk; o componente do navegador procurava apenas output.
- Tentativas que falharam: alteraÃ§Ãµes repetidas no runner e reinÃ­cios sem corrigir o leitor do cliente.
- SoluÃ§Ã£o validada: aceitar output e chunk.
- ValidaÃ§Ã£o: Write-Output, Write-Host, Write-Warning, stderr e caracteres PT-PT foram capturados.
- Regra permanente: nunca remover compatibilidade com chunk sem alterar explicitamente o protocolo.

## PSB-002 â€” NÃ£o percorrer o histÃ³rico completo do ChatGPT

- Estado: decisÃ£o permanente
- Sintoma: conversas grandes ficavam progressivamente lentas e deixavam de responder.
- Causa: varrimentos periÃ³dicos de todas as mensagens, hashes de blocos enormes, Web Worker e consola persistente dentro da pÃ¡gina.
- SoluÃ§Ã£o: observar apenas mutaÃ§Ãµes do turno novo, sem polling quando nÃ£o existe job ativo.
- Regra permanente: o componente do navegador nÃ£o deve voltar a analisar todo o histÃ³rico.