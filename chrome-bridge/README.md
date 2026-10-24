# FiscalGuard PT — ligação à sessão AT JÁ aberta no Chrome

Esta extensão Manifest V3 foi criada precisamente para não voltar a pedir login
em cada teste. Utiliza o Chrome **normal e o perfil em que o utilizador já se
autenticou**. Não abre outra instância Chrome com outro user-data-dir, não lê
cookies diretamente, não contém NIF/palavra-passe e não guarda tokens.

## Preparação única

1. Garantir que a versão web do FiscalGuard que inclui a ponte Chrome está
   instalada e a funcionar no computador, no endereço
   `http://127.0.0.1:4848`. As versões anteriores não entendem a ponte.
2. Colocar a pasta `chrome-bridge` num local permanente em **D:**. Não apagar
   nem mover a pasta depois de ativar a extensão no Chrome.
3. **No MESMO perfil Chrome em que está a sessão das Finanças**, abrir
   `chrome://extensions`, ativar o modo de programador e selecionar
   **Carregar sem compactação**. Escolher a pasta `chrome-bridge`.
4. Reabrir/recarregar a aba `http://127.0.0.1:4848`. O FiscalGuard procura
   a extensão e consulta a AT através do Chrome já autenticado.

Instalar uma extensão no Chrome pode criar metadados no perfil já existente do
navegador; o diretório de código da extensão fica em D:, mas o Chrome utiliza
os seus próprios caminhos para registo e cache.

## Funcionamento

- A interface local pergunta ao serviço da extensão se há uma sessão AT.
- A extensão encontra uma aba `sitfiscal.portaldasfinancas.gov.pt` no Chrome
  ou abre uma aba **inativa**, sempre no Chrome em utilização (mesmos cookies).
- Um content script executado no mesmo domínio pede apenas cinco consultas GET
  de leitura, nunca emite documentos nem altera obrigações.
- Apenas contagens, data e estado técnico regressam à interface local; nunca
  o corpo JSON, NIF, password, cookies, montantes, matrículas ou tokens.
- Uma falha de resposta é **não confirmado**; nunca é tratada automaticamente
  como expiração da sessão. Se a AT redirecionar claramente para um login, é a
  própria AT que exige nova autenticação.
- Enquanto o Chrome se mantiver com sessão válida, a extensão pode voltar a
  consultar a AT sem pedir novo login.

## Limitações que ainda não foram validadas

- O código está testado no GitHub com respostas simuladas, mas ainda não foi
  testado **na sessão real do utilizador**, nem os caminhos de API atuais da AT
  foram confirmados.
- A versão web local instalada anteriormente não se atualiza sozinha; é
  necessária uma atualização controlada **uma vez**.
- O navegador tem de continuar aberto e autenticado para as consultas
  automáticas. O prazo real de expiração da sessão é definido pela AT.
- A extensão só recolhe **contagens agregadas** de mensagens, dívidas e coimas.
  Não faz ainda recolha completa de IUC ou Segurança Social.
- O endpoint HTTP local não é uma prova criptográfica da autoria do content
  script. Não publicar nem expor o servidor à Internet.

**Nunca guardar credenciais AT em GitHub Actions, ficheiros do repositório ou
capturas de diagnóstico.** Não utilizar esta extensão noutros websites.
