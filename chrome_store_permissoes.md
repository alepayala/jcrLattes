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

### 📝 JUSTIFICATIVA DAS PERMISSÕES DE HOST (CHROME WEB STORE SUBMISSION FORM)

**English (Recommended for Chrome Web Store Developer Console Form):**
> * `buscatextual.cnpq.br` — the Lattes CV pages themselves. The extension annotates the
>   impact factor of each article directly in the CV the user is already viewing.
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
> * `tabs` — abrir a página do banco de dados e os relatórios em novas abas.
> * `scripting` — anotar o currículo aberto e montar os relatórios na própria página.

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

