# JCRLattes — formulário de envio da Chrome Web Store (uso interno)

> Campos de justificativa do Chrome Web Store Developer Console e checklist de envio.
> Nada daqui aparece na página pública da extensão: o texto público fica em
> `chrome_store_description.md`, que pode ser copiado inteiro para a loja.

--------------------------------------------------

### ✅ CHECKLIST ANTES DE GERAR O ZIP DA LOJA

* piccTools continua **desabilitado por padrão** e fora de todo texto público.
* Versão do `dist/manifest.json` incrementada em relação à publicada.
* `chrome_store_description.md` (e a versão no topo dele e no README) atualizados com o que muda para o usuário.

--------------------------------------------------

### 📋 TEXTOS DO FORMULÁRIO — VERSÃO 2.0.2 (cada campo aceita até 1000 caracteres)

> O que vai em cada campo da aba "Práticas de privacidade" do console. "downloads" e
> "Permissão do host" (versão curta) estão nas seções abaixo. O propósito não cita Qualis: a
> extensão não o anota.

**Descrição do único propósito** (269 caracteres):

```
O propósito único desta extensão é anotar o Fator de Impacto (JCR) e gerar estatísticas da produção científica diretamente nas páginas de currículos da Plataforma Lattes, com um banco de dados local desses currículos para relatórios individuais e de grupos de pesquisa.
```

**Justificativa de storage** (286 caracteres):

```
A extensão guarda no navegador ('chrome.storage.local') as opções do usuário (limiares de JCR, período, cores e filtros) e o banco de dados local dos currículos que ele decide salvar, com os indicadores usados nos relatórios individuais e de grupo. Nada é enviado a servidores externos.
```

**Justificativa de unlimitedStorage** (542 caracteres):

```
A permissão 'unlimitedStorage' é essencial porque a extensão atua como um banco de dados local off-line ('chrome.storage.local') para pesquisadores e programas de pós-graduação. Os usuários podem salvar dezenas ou até centenas de currículos — contendo grandes arranjos de dados de artigos, patentes e orientações — para gerar relatórios coletivos. Esse volume de dados tabulares excede facilmente a cota padrão de 5MB imposta pelo Chrome, sendo o armazenamento ilimitado indispensável para evitar perdas de dados acadêmicos salvos localmente.
```

**Justificativa de tabs** (526 caracteres):

```
A permissão 'tabs' é requerida para a extensão abrir e gerenciar abas. (1) Abre a página do banco de dados e os relatórios da própria extensão. (2) Para completar o relatório com o perfil público do pesquisador na Web of Science/ResearcherID, no Google Scholar e no Scopus, cujo endereço ou identificador consta no currículo, abre a página do perfil numa aba inativa ('chrome.tabs.create({ active: false })'), acompanha o carregamento ('chrome.tabs.onUpdated') e fecha a aba em seguida, sem interromper a navegação do usuário.
```

**Justificativa de scripting** (457 caracteres):

```
A permissão 'scripting' é necessária para ler as métricas públicas do pesquisador. O JCRLattes usa 'chrome.scripting.executeScript' somente nas abas da Web of Science/ResearcherID, do Google Scholar e do Scopus que ele mesmo abre temporariamente em segundo plano, para ler o índice H, o total de citações e o número de publicações, sem exigir que o usuário copie esses dados à mão. O script faz parte do pacote da extensão; nenhum código remoto é executado.
```

--------------------------------------------------

### 📝 JUSTIFICATIVA DAS PERMISSÕES DE HOST (CHROME WEB STORE SUBMISSION FORM)

**Versão curta (o campo do formulário aceita até 1000 caracteres) — colar esta:**

```
The extension only reads pages the user can already open; it sends no data anywhere and stores everything locally.
- buscatextual.cnpq.br, busca-cv-lattes.cnpq.br: the Lattes CV pages (old and new address), where the impact factor of each article is annotated.
- busca-cv-lattes-api.cnpq.br: the public data service the new Lattes site itself calls; used to refresh CVs already saved in the local database, at the user's request, without opening one tab per CV.
- researcherid.com, webofscience.com, scholar.google.com, scopus.com: the researcher's public profile, whose address or ID is given in the CV; read to get the h-index, citations and number of publications (at most once a day per researcher).
- efomento.cnpq.br, anexosform.cnpq.br, plsql1.cnpq.br: CNPq's grant system. For authorized reviewers only, reads the judgment spreadsheet, proposal PDFs and archived CVs they already have access to, and organizes them locally.
```

Em português (971 caracteres):

```
A extensão só lê páginas que o usuário já consegue abrir; não envia dados a lugar nenhum e guarda tudo localmente.
- buscatextual.cnpq.br, busca-cv-lattes.cnpq.br: as páginas do currículo Lattes (endereço antigo e novo), onde o fator de impacto de cada artigo é anotado.
- busca-cv-lattes-api.cnpq.br: serviço de dados públicos que o próprio site novo do Lattes consulta; usado para atualizar currículos já salvos no banco local, a pedido do usuário, sem abrir uma aba por currículo.
- researcherid.com, webofscience.com, scholar.google.com, scopus.com: perfil público do pesquisador, cujo endereço ou ID consta no currículo; lido para obter índice h, citações e número de publicações (no máximo uma vez por dia por pesquisador).
- efomento.cnpq.br, anexosform.cnpq.br, plsql1.cnpq.br: sistema de fomento do CNPq. Só para avaliadores autorizados: lê a planilha de julgamento, os PDFs das propostas e os currículos arquivados a que já têm acesso, e os organiza localmente.
```

**Versão longa, para referência:**

**English (Recommended for Chrome Web Store Developer Console Form):**
> * `buscatextual.cnpq.br` — the Lattes CV pages themselves. The extension annotates the
>   impact factor of each article directly in the CV the user is already viewing.
> * `busca-cv-lattes.cnpq.br` — the new Lattes CV pages (the platform's new address). Same
>   use: the extension annotates the CV the user is viewing.
> * `busca-cv-lattes-api.cnpq.br` — the public data service that the new Lattes site itself
>   calls to display a CV. The extension reads the same public CV data from it to refresh
>   CVs already saved in the user's local database, when the user asks for it, without
>   opening one tab per CV. No login, no data sent.
> * `scholar.google.com` — when the CV itself gives the address of the researcher's public
>   Google Scholar profile, the extension opens that profile to read the public h-index,
>   i10-index, citation count and number of publications. At most once a day per researcher.
> * `www.scopus.com` — when the CV gives the researcher's Scopus ID, the extension opens the
>   public author page (Scopus Preview, no login) to read the h-index, citation count and
>   number of documents. At most once a day per researcher.
> * `researcherid.com` / `webofscience.com` — read the user's public citation and h-index
>   figures to complete the production report.
> * `efomento.cnpq.br` — CNPq's grant management system. For users who are already
>   authorized reviewers, the extension reads the judgment spreadsheet **they already have
>   access to** and organizes the proposals under their review into a local database.
> * `anexosform.cnpq.br` — the host that serves the proposal PDFs and their attachments,
>   linked from that same spreadsheet.
> * `plsql1.cnpq.br` — frozen (archived) Lattes CVs linked from the proposals.
>
> The extension only reads pages the signed-in user can already open by hand; it never
> creates sessions, never sends data to third parties, and stores everything locally.

**Português (para conferência do desenvolvedor):**
> * `buscatextual.cnpq.br` — as próprias páginas de currículo Lattes, onde o fator de
>   impacto é anotado.
> * `busca-cv-lattes.cnpq.br` — as páginas de currículo do Lattes novo (novo endereço da
>   plataforma). Mesmo uso: anotar o currículo que o usuário está vendo.
> * `busca-cv-lattes-api.cnpq.br` — o serviço de dados públicos que o próprio site novo do
>   Lattes consulta para mostrar um currículo. A extensão lê dele os mesmos dados públicos
>   para atualizar currículos já salvos no banco local, a pedido do usuário, sem abrir uma
>   aba por currículo. Sem login, sem envio de dados.
> * `scholar.google.com` — quando o próprio currículo informa o endereço do perfil público do
>   pesquisador no Google Scholar, a extensão abre esse perfil para ler o índice h, o i10, as
>   citações e o número de publicações, todos públicos. No máximo uma vez por dia por pesquisador.
> * `www.scopus.com` — quando o currículo informa o Scopus ID do pesquisador, a extensão abre a
>   página pública do autor (Scopus Preview, sem login) para ler o índice h, as citações e o
>   número de documentos. No máximo uma vez por dia por pesquisador.
> * `researcherid.com` / `webofscience.com` — leitura das citações e do índice h públicos.
> * `efomento.cnpq.br` — sistema de fomento do CNPq. Para quem já é avaliador autorizado,
>   a extensão lê a planilha de julgamento **à qual essa pessoa já tem acesso** e organiza
>   localmente as propostas sob sua responsabilidade.
> * `anexosform.cnpq.br` — servidor dos PDFs das propostas e dos anexos.
> * `plsql1.cnpq.br` — currículos Lattes congelados vinculados às propostas.
>
> A extensão só lê páginas que o usuário autenticado já consegue abrir manualmente; não
> cria sessões, não envia dados a terceiros e guarda tudo localmente.

--------------------------------------------------

### 📝 JUSTIFICATIVA DAS DEMAIS PERMISSÕES

> * `storage` / `unlimitedStorage` — o banco de dados de currículos e propostas fica no
>   navegador do usuário; `unlimitedStorage` é necessário porque cópias de currículos e
>   documentos ultrapassam a cota padrão.
> * `tabs` — abrir a página do banco de dados e os relatórios em novas abas, e abrir (e fechar
>   em seguida) a aba em segundo plano do perfil público do pesquisador no ResearcherID /
>   Web of Science, no Google Scholar e no Scopus.
> * `scripting` — ler, na aba do perfil público do pesquisador que a extensão abre no
>   ResearcherID / Web of Science, no Google Scholar e no Scopus, o índice h, as citações e o número de
>   publicações (`chrome.scripting.executeScript` nessa aba, e só nela). A anotação do
>   currículo em si é feita pelos content scripts declarados no manifest.
>
> English: `tabs` — open the extension's own database/report pages, and open (then close) a
> background tab on the researcher's public ResearcherID / Web of Science, Google Scholar and
> Scopus profile. `scripting` — read the public h-index, citation count and number of publications
> from that profile tab only (`chrome.scripting.executeScript`). `storage` /
> `unlimitedStorage` — the CV database is kept in the user's browser.

--------------------------------------------------

### 📝 JUSTIFICATIVA PARA A PERMISSÃO "downloads" (CHROME WEB STORE SUBMISSION FORM)

**English (Recommended for Chrome Web Store Developer Console Form):**
> The "downloads" permission is strictly required to allow users to export and save their academic data and reports to their local disk. Specifically:
> 1. Exporting local database backups as JSON files for data portability, backup, and restoration across devices.
> 2. Exporting consolidated scientific production tables and metrics as CSV files for offline statistical analysis in spreadsheet applications (e.g., Microsoft Excel).
> 3. Saving offline backup copies of academic document reports (in PDF and HTML formats) directly to the user's local Downloads folder for offline consultation when academic servers are unavailable.
> No automatic or background downloads occur without explicit user interaction (clicking export/download buttons).

**Português (Para conferência do desenvolvedor):**
> A permissão "downloads" é estritamente necessária para permitir que o usuário exporte e salve seus dados e relatórios acadêmicos no disco rígido. Especificamente:
> 1. Exportação de backups do banco de dados local em arquivos JSON para portabilidade e restauração em outros dispositivos.
> 2. Exportação de relatórios e métricas de produção científica em arquivos CSV para análise estatística em planilhas (como o Excel).
> 3. Salvamento de cópias de backup de documentos acadêmicos (PDF e HTML) na pasta Downloads local para consulta offline quando os servidores estiverem indisponíveis.
> Nenhum download é realizado em segundo plano sem a ação direta e explícita do usuário (clique nos botões de exportação/salvamento).

