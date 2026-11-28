# JCRLattes

**Versão 2.0.2**

O JCRLattes é a ferramenta definitiva para pesquisadores, acadêmicos, coordenadores de pós-graduação e avaliadores que buscam eficiência na análise da Plataforma Lattes. 

Esta extensão automatiza a extração, anotação e visualização de métricas de impacto e indicadores de autoria diretamente no currículo Lattes (CNPq), transformando dados brutos em inteligência acadêmica instantânea, 100% privada e com design premium.

O repositório inclui:
1. **Extensão para Google Chrome (`/dist`)**: Adiciona funcionalidades ao currículo Lattes.
2. **Leitor do backup JSON (`tools/parse_jcr_backup.py`)**: Módulo Python que lê o backup JSON exportado pela extensão e entrega os currículos prontos para qualquer análise offline. Traz, como exemplo de uso, um gerador de grafo de colaboração.

---

## 🚀 Principais Funcionalidades (Extensão)

### 1. Métricas de Impacto e Anotação em Tempo Real
* **Anotação de Fator de Impacto (JCR)**: Exibe o Fator de Impacto (JCR) mais recente logo abaixo de cada artigo no próprio currículo Lattes. Cores dinâmicas facilitam a triagem visual, numa paleta padrão legível por daltônicos e personalizável.
* **Histograma de Distribuição JCR**: Gráfico interativo que revela o perfil de qualidade da sua produção ao longo do tempo.
* **Métricas de Produção por Ano**: Visualize a evolução da sua carreira com barras empilhadas que mostram o impacto acumulado anualmente.
* **Segunda Linha de Gráficos**:
  - **Orientações por Ano**: Histograma de orientações concluídas de pós-graduação por ano (Pós-doutorado em Verde-azulado, Doutorado em Azul, Mestrado em Laranja), complementado por colunas para Orientações em Andamento (`EA`) com cores fracionadas, Iniciação Científica (`IC`) em Vermelho e Outras Orientações (`Out.`) em Cinza.
* **Tabelas Estatísticas Dinâmicas**: Tabelas com Somatórios e Médias automáticas para períodos customizados.
* **Citação e Índice H**: Consolidação automática do Índice H e número de citações para Web of Science e Scopus. Quando o currículo informa o endereço do perfil no Google Scholar ou o Scopus ID, a extensão lê também esses perfis (índice H, citações e número de publicações).

### 2. Gerenciamento e Banco de Dados Local
* **Banco de Dados de Currículos**: Salve múltiplos currículos Lattes localmente no seu navegador para consultas futuras e análises comparativas.
* **Consolidação Instantânea de Grupos**: Atribua IDs customizados (ex: siglas de laboratórios) aos currículos para compilar métricas integradas em tempo real. Quem participou do grupo só por um tempo pode ter o período (início e fim) registrado ao receber o ID, e o relatório do grupo conta apenas a produção desse intervalo; o padrão é toda a carreira, aceito com um Enter. 
* **Deduplicação Inteligente**: O relatório de grupo remove de forma automática artigos, patentes e orientações em coautoria repetidos entre os membros, gerando métricas reais da produção coletiva.
* **Tabela de Membros do Grupo**: Indicadores de cada membro num período escolhido (artigos por faixa de JCR, soma e média do JCR, orientações de doutorado e mestrado, patentes), com índice H e citações WoS da carreira toda. Ordenável por qualquer coluna e exportável para Excel (.xlsx).
* **Backup e Portabilidade**: Exporte todo o seu banco de dados em formato JSON ou exporte os dados tabulados em CSV para análise.

### 3. Análise Acadêmica Avançada
* **Papel de Autoria**: Identificação automatizada do Primeiro Autor (1º) em cada publicação.
* **Recursos temporariamente desabilitados**: a nova Plataforma Lattes ainda não mostra a lista completa de autores de parte dos artigos. Enquanto isso, ficam desligados (as colunas continuam nas tabelas, com traços) o último autor, a posição de autoria além do 1º lugar, o número e a média de autores e as grandes colaborações.
* **Portfólio de Inovação e Patentes**: Gestão de patentes classificadas por status (Depósito, Concessão).
* **Painel de Orientações**: Resumo consolidado e gráficos de orientações (Pós-doutorado, Doutorado, Mestrado, Iniciação Científica, etc.).

---

## 🛠️ Como Instalar e Usar a Extensão

1. Baixe ou clone este repositório.
2. Abra o Google Chrome e acesse `chrome://extensions/`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** (Load unpacked) e selecione a pasta `dist` deste projeto.
5. Acesse qualquer currículo na Plataforma Lattes e a extensão injetará as métricas automaticamente. Funciona na [nova busca de currículos](https://busca-cv-lattes.cnpq.br/) e também nas páginas do formato anterior.

> **Dica:** fixe o JCRLattes na barra do Chrome (ícone de quebra-cabeça 🧩 → alfinete 📌 ao lado de JCRLattes). Assim o banco de CVs abre com um clique no ícone da extensão, de qualquer página, sem precisar estar num currículo.

---

## 🐍 Leitor do Backup JSON (`tools/parse_jcr_backup.py`)

O objetivo do `parse_jcr_backup.py` é ser a porta de entrada para os dados da extensão em Python: ele lê o backup JSON exportado pelo painel e devolve os currículos já organizados, para que você monte as suas próprias análises. O grafo de colaboração descrito mais abaixo é um exemplo do que dá para fazer com ele.

A leitura segue as mesmas regras da extensão:
* Aceita os três tipos de exportação: o banco geral, o backup de um grupo (ID customizado) e o backup de propostas. Só os currículos viram pesquisadores; propostas e registros de configuração ficam separados.
* Identifica o pesquisador pelo ID Lattes (não pelo nome, para não juntar homônimos) e junta registros repetidos do mesmo ID, mantendo o currículo completo mais recente.
* Marca os "esqueletos" (registros só com nome, sem o currículo).
* Identifica cada artigo pelo DOI ou, sem ele, pelo título e ano — a mesma chave da Matriz de Coautoria. Para contar artigos em comum num conjunto de currículos, `pub_id_resolver(cvs)` aplica também a regra da matriz para o artigo que está com DOI num currículo e sem DOI no outro.

### Requisitos
A leitura não precisa de nenhuma biblioteca externa. Só o exemplo do grafo precisa de:
```bash
pip install networkx matplotlib
```

### Usando o leitor nas suas análises
Exporte o backup JSON pelo painel da extensão (o arquivo baixado será algo como `jcr_lattes_database_backup.json`) e, de dentro da pasta `tools/`:
```python
from parse_jcr_backup import load_backup, find_researcher, get_pub_id

dados = load_backup('jcr_lattes_database_backup.json')
for cv in dados.cvs:                     # CVData: nome, ID Lattes, ID customizado, publicações,
    print(cv.name, len(cv.publications)) # patentes, eventos, orientações e o registro bruto (raw_data)

ana = find_researcher(dados.cvs, 'Ana Silva')        # por nome ou pelo ID Lattes
artigos = {get_pub_id(p) for p in ana.publications}  # chave do artigo (DOI ou título + ano)
```
`dados.proposals` traz as propostas, quando o arquivo é um backup de propostas.

### Exemplo: grafo de colaboração
Pela linha de comando, o script imprime um resumo de cada currículo e, com `--graph`, desenha a rede de artigos em comum:
```bash
cd tools
python parse_jcr_backup.py jcr_lattes_database_backup.json --graph
```

Isso irá:
1. Ler todos os currículos do backup e informar propostas, esqueletos e duplicatas encontrados.
2. Imprimir um sumário de cada currículo no terminal.
3. Identificar os artigos publicados em comum.
4. Gerar um **Grafo de Rede de Colaboração (network_graph.png)** visualizando as pontes e a densidade das publicações em conjunto.

### Opções do Grafo
Você pode customizar a geração através do arquivo `tools/config.json` ou passando parâmetros via linha de comando:
* `--target-custom-id "SIGLA"`: Filtra e gera o grafo *apenas* para os currículos que possuam este ID customizado.
* `--ignore-isolated`: Oculta pesquisadores sem conexões (publicações em comum) da imagem.
* `--target-researcher "Nome"`: Gera um Ego-Graph (raio 1) focado apenas neste pesquisador específico e seus colaboradores diretos. Aceita também o ID Lattes; se o nome corresponder a mais de uma pessoa, o script lista os candidatos.

---

## 🔒 Privacidade e Segurança Absoluta
**Processamento 100% Local**: A extensão e o banco de dados rodam inteiramente no seu navegador utilizando `chrome.storage`. Nenhum dado é enviado para servidores externos.
