# DecisÃµes de arquitetura

## DEC-001 â€” Comandos fora da conversa

Os comandos completos sÃ£o entregues como anexos temporÃ¡rios. A conversa contÃ©m apenas um manifesto JSON pequeno.

## DEC-002 â€” Resultados por URL

O resultado completo sanitizado Ã© publicado na branch untime. O ChatGPT recebe apenas o URL de esult.json e esult.txt.

## DEC-003 â€” Multi-conversa

Cada aba do ChatGPT tem um 	abId e uma conversationId. A bridge aceita atÃ© 8 jobs simultÃ¢neos e publica cada resultado numa pasta separada por conversa.

## DEC-004 â€” HistÃ³rico runtime limitado

A branch untime Ã© atualizada com commit --amend e push --force, mantendo um Ãºnico snapshot acessÃ­vel. SÃ£o guardados no mÃ¡ximo 5 resultados por conversa e 50 no total.