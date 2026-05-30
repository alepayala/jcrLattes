# JCRLattes

**Versão 1.5.2**

O JCRLattes é a ferramenta definitiva para pesquisadores, acadêmicos, coordenadores de pós-graduação e avaliadores que buscam eficiência na análise da Plataforma Lattes. 

Esta extensão automatiza a extração, anotação e visualização de métricas de impacto e indicadores de autoria diretamente no currículo Lattes (CNPq), transformando dados brutos em inteligência acadêmica instantânea, 100% privada e com design premium.

O repositório inclui:
1. **Extensão para Google Chrome (`/dist`)**: Adiciona funcionalidades ao currículo Lattes.
2. **Parser JSON e Gerador de Grafo (`parse_jcr_backup.py`)**: Script em Python para análise offline e geração de grafos de colaboração a partir do backup JSON gerado pela extensão.

---

## 🚀 Principais Funcionalidades (Extensão)

### 1. Métricas de Impacto e Anotação em Tempo Real
* **Anotação de Fator de Impacto (JCR)**: Exibe o Fator de Impacto (JCR) mais recente e a contagem de autores logo abaixo de cada artigo no próprio currículo Lattes. Cores dinâmicas facilitam a triagem visual.
* **Histograma de Distribuição JCR**: Gráfico interativo que revela o perfil de qualidade da sua produção ao longo do tempo.
* **Métricas de Produção por Ano**: Visualize a evolução da sua carreira com barras empilhadas que mostram o impacto acumulado anualmente.
* **Tabelas Estatísticas Dinâmicas**: Tabelas com Somatórios e Médias automáticas para períodos customizados.
* **Citação e Índice H**: Consolidação automática do Índice H e número de citações para Web of Science e Scopus.

### 2. Gerenciamento e Banco de Dados Local
* **Banco de Dados de Currículos**: Salve múltiplos currículos Lattes localmente no seu navegador para consultas futuras e análises comparativas.
* **Consolidação Instantânea de Grupos**: Atribua IDs customizados (ex: siglas de laboratórios) aos currículos para compilar métricas integradas em tempo real. 
* **Deduplicação Inteligente**: O relatório de grupo remove de forma automática artigos, patentes e orientações em coautoria repetidos entre os membros, gerando métricas reais da produção coletiva.
* **Backup e Portabilidade**: Exporte todo o seu banco de dados em formato JSON ou exporte os dados tabulados em CSV para análise.

### 3. Análise Acadêmica Avançada
* **Papel de Autoria**: Identificação automatizada como Primeiro Autor (1º) ou Último Autor (Últ) em cada publicação.
* **Média Real de Coautores**: Cálculo da média de coautores por artigo, com opção de desconsiderar Grandes Colaborações (consórcios).
* **Portfólio de Inovação e Patentes**: Gestão de patentes classificadas por status (Depósito, Concessão).
* **Painel de Orientações**: Resumo consolidado de orientações (Doutorado, Mestrado, Iniciação Científica, etc).

---

## 🛠️ Como Instalar e Usar a Extensão

1. Baixe ou clone este repositório.
2. Abra o Google Chrome e acesse `chrome://extensions/`.
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** (Load unpacked) e selecione a pasta `dist` deste projeto.
5. Acesse qualquer currículo na [Plataforma Lattes](https://lattes.cnpq.br/) e a extensão injetará as métricas automaticamente.

---

## 🐍 Parser Python & Grafo de Colaboração (`parse_jcr_backup.py`)

O repositório inclui um script em Python desenvolvido para analisar o banco de dados JSON exportado pela extensão e gerar visualizações complexas de rede.

### Requisitos:
```bash
pip install networkx matplotlib
```

### Uso Básico:
Exporte o backup JSON através do painel da extensão (o arquivo baixado será algo como `jcr_lattes_database_backup.json`).

Execute o script passando o arquivo JSON exportado:
```bash
python parse_jcr_backup.py jcr_lattes_database_backup.json --graph
```

Isso irá:
1. Analisar todos os currículos Lattes exportados.
2. Identificar conexões e artigos publicados em comum.
3. Imprimir um sumário das estatísticas (H-Index, Publicações, Patentes, Orientações) no terminal.
4. Gerar um **Grafo de Rede de Colaboração (network_graph.png)** visualizando as pontes e a densidade das publicações em conjunto.

### Opções Avançadas de Grafo
Você pode customizar a geração através do arquivo `config.json` ou passando parâmetros via linha de comando:
* `--target-custom-id "SIGLA"`: Filtra e gera o grafo *apenas* para os currículos que possuam este ID customizado.
* `--ignore-isolated`: Oculta pesquisadores sem conexões (publicações em comum) da imagem.
* `--target-researcher "Nome"`: Gera um Ego-Graph (raio 1) focado apenas neste pesquisador específico e seus colaboradores diretos.

---

## 🔒 Privacidade e Segurança Absoluta
**Processamento 100% Local**: A extensão e o banco de dados rodam inteiramente no seu navegador utilizando `chrome.storage`. Nenhum dado é enviado para servidores externos.
