"""
Leitor do backup JSON exportado pela extensao JCRLattes.

O objetivo e dar acesso aos dados da extensao em Python para qualquer analise
offline: load_backup() devolve os curriculos (CVData) e, num backup de propostas,
as propostas, com as mesmas regras de identificacao da extensao. find_researcher()
acha um pesquisador por nome ou ID Lattes e get_pub_id() da a chave de um artigo.

O grafo de colaboracao (generate_network_graph, opcao --graph) e um exemplo de uso;
so ele precisa de networkx e matplotlib.

    from parse_jcr_backup import load_backup
    dados = load_backup('jcr_lattes_database_backup.json')
    for cv in dados.cvs:
        print(cv.name, len(cv.publications))
"""
import json
import argparse
import re
import textwrap
import unicodedata
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from itertools import combinations

# O formato do JSON e o da extensao (dist/scripts/db_tools.js). Ela exporta tres
# arquivos, todos uma lista de registros:
#   jcr_lattes_database_backup.json        banco geral: so CVs
#   <ID>_jcr_lattes_database_backup.json   um grupo (ID de grupo): so CVs
#   jcr_lattes_picc_backup_<data>.json     piccTools: propostas, CVs da base do
#                                          piccTools (inclusive esqueletos) e um
#                                          registro de configuracao
# So os CVs viram pesquisadores. Quem identifica o pesquisador e o ID Lattes, nunca
# o nome: e a mesma regra da extensao (cvMatches), que evita juntar homonimos.

@dataclass
class CVData:
    """
    Structured representation of a single Lattes CV from the database backup.
    Contains all available information extracted by the extension.
    """
    name: str
    lattes_id: str
    custom_id: str
    link: str
    publications: List[Dict[str, Any]]
    patents: List[Dict[str, Any]]
    events: List[Dict[str, Any]]
    supervisions: List[Dict[str, Any]]
    declared_citations: Dict[str, Any]
    date_added: str
    raw_data: Dict[str, Any]
    # registro so com nome/bolsa/formacao, criado ao importar uma proposta
    skeleton: bool = False

    @property
    def key(self) -> str:
        """Identificador do pesquisador: o ID Lattes; sem ele, o nome normalizado."""
        return f"id:{self.lattes_id}" if self.lattes_id else f"nm:{normalize_name(self.name)}"


@dataclass
class BackupContents:
    cvs: List[CVData]
    proposals: List[Dict[str, Any]] = field(default_factory=list)
    skeletons: int = 0
    duplicates: int = 0
    ignored: int = 0


def normalize_name(s: Any) -> str:
    """Mesma normalizacao de JCRDBTools.normalizeName: sem acentos, caixa e pontuacao."""
    t = unicodedata.normalize('NFD', str(s or ''))
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]', ' ', t)).strip()


_PARTICLES = {'da', 'de', 'do', 'das', 'dos', 'e', 'd', 'del', 'della', 'di', 'du', 'van', 'von'}
_SUFFIXES = {'junior', 'jr', 'filho', 'filha', 'neto', 'neta', 'sobrinho', 'sobrinha'}


def name_tokens(name: Any) -> List[str]:
    """Mesmo criterio de JCRDBTools._tokensNome."""
    t = [p for p in normalize_name(name).split(' ') if p and p not in _PARTICLES]
    while len(t) > 2 and t[-1] in _SUFFIXES:
        t.pop()
    return t


def names_compatible(a: Any, b: Any) -> bool:
    """Mesmo criterio de JCRDBTools._nomesCompativeis: nome identico, ou mesmo
    primeiro e ultimo nome com ao menos dois nomes de cada lado. Compara palavras,
    nunca letras: "Ana Silva" nao casa com "Luciana Silva"."""
    n1, n2 = normalize_name(a), normalize_name(b)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    t1, t2 = name_tokens(a), name_tokens(b)
    if len(t1) < 2 or len(t2) < 2:
        return False
    return t1 == t2 or (t1[0] == t2[0] and t1[-1] == t2[-1])


def _is_full_cv(entry: Dict[str, Any]) -> bool:
    """Versao resumida de JCRDBTools.isFullCv."""
    if entry.get('hasFullCv') is True:
        return True
    if entry.get('hasFullCv') is False:
        return False
    if entry.get('publications') or entry.get('rawPatents') or entry.get('totalPapers'):
        return True
    return bool(entry.get('dateAdded')) and ('publications' in entry or 'totalPapers' in entry)


def _as_list(v: Any) -> List[Any]:
    return v if isinstance(v, list) else []


def load_backup(file_path: str) -> BackupContents:
    """
    Reads any of the extension's JSON exports and separates researchers (CVs)
    from proposals and configuration records.
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Handle different possible JSON export structures (list vs dict)
    if isinstance(data, dict):
        if 'jcrLattesCVs' in data:
            entries = list(data['jcrLattesCVs'].values())
        else:
            entries = list(data.values())
    else:
        entries = data

    out = BackupContents(cvs=[])
    by_key: Dict[str, CVData] = {}

    for entry in entries:
        if not isinstance(entry, dict):
            out.ignored += 1
            continue
        if entry.get('__piccConfig'):
            continue                                  # mapa de chamadas do piccTools
        if entry.get('isProcesso') or entry.get('processId'):
            out.proposals.append(entry)               # proposta, nao pesquisador
            continue

        # Backward compatibility with older exports
        name_link = entry.get('nameLink') or {}
        name = entry.get('name') or name_link.get('name') or ''
        lattes_id = str(entry.get('lattesId') or name_link.get('lattesId') or '').strip()
        if not name and not lattes_id:
            out.ignored += 1
            continue

        if lattes_id:
            link = f"http://lattes.cnpq.br/{lattes_id}"
        else:
            link = entry.get('cvLink') or name_link.get('link') or 'No Link'

        # Handle supervisions structure
        raw_supervisions = entry.get('supervisions', [])
        if isinstance(raw_supervisions, dict) and 'raw' in raw_supervisions:
            sups_list = _as_list(raw_supervisions.get('raw'))
        else:
            sups_list = _as_list(raw_supervisions)

        cv = CVData(
            name=name or 'Unknown Researcher',
            lattes_id=lattes_id,
            custom_id=entry.get('customId') or '',
            link=link,
            publications=_as_list(entry.get('publications')),
            # 'patents' hoje e o resumo {total, statusCounts}; a lista e rawPatents
            patents=_as_list(entry.get('rawPatents')) or _as_list(entry.get('patents')),
            events=_as_list(entry.get('rawEvents')) or _as_list(entry.get('events')),
            supervisions=sups_list,
            declared_citations=entry.get('declaredCitations') or {},
            date_added=entry.get('dateAdded') or 'Unknown Date',
            raw_data=entry,
            skeleton=not _is_full_cv(entry),
        )

        # A mesma pessoa duas vezes (ex.: backups juntados): fica o CV completo e,
        # entre iguais, o mais novo — a mesma escolha de _mesclarVersoesCv.
        prev = by_key.get(cv.key)
        if prev is not None:
            out.duplicates += 1
            if (not cv.skeleton, cv.date_added) <= (not prev.skeleton, prev.date_added):
                continue
        by_key[cv.key] = cv

    for cv in by_key.values():
        if cv.skeleton:
            out.skeletons += 1
        out.cvs.append(cv)
    return out


def parse_jcr_backup(file_path: str) -> List[CVData]:
    """
    Reads the JSON backup file and returns the researchers (CVs) in it.
    Proposals and configuration records are left out; see load_backup.
    """
    return load_backup(file_path).cvs


def get_pub_id(pub: Dict[str, Any]) -> str:
    """
    Identificador de um artigo, igual ao de JCRDBTools._chaveArtigo (a Matriz de
    Coautoria): o DOI; sem ele, o titulo normalizado + o ano. A referencia completa
    nao serve: traz a lista de autores, escrita de um jeito em cada CV.
    """
    doi = str(pub.get('doi') or '').strip().lower()
    if doi:
        return 'doi:' + doi
    title = str(pub.get('paperTitle') or pub.get('title') or '')
    title = re.sub(r'<[^>]*>', ' ', title)
    title = re.sub(r'&[a-z#0-9]+;', ' ', title, flags=re.I)
    title = re.sub(r'\$\$[\s\S]*?\$\$', ' ', title)
    title = unicodedata.normalize('NFD', title)
    title = ''.join(c for c in title if unicodedata.category(c) != 'Mn').lower()
    title = re.sub(r'[^a-z0-9]+', ' ', title).strip()
    if title:
        return f"tt:{title}|{pub.get('year') or ''}"
    # Backups antigos nao tem paperTitle (a extensao pede para atualizar esses CVs);
    # ai so resta a referencia, que raramente casa entre CVs, mas nao custa tentar.
    ref = re.sub(r'\W+', '', str(pub.get('reference') or '')).lower()
    return f"ref:{ref}" if ref else ''


def find_researcher(cvs: List[CVData], query: str) -> Optional[CVData]:
    """
    Acha UM pesquisador por ID Lattes ou nome. Nome: identico (sem acentos/caixa);
    senao, o unico compativel. Ambiguo ou ausente: None, com aviso dos candidatos.
    """
    q = str(query or '').strip()
    if re.fullmatch(r'\d{16}', q):
        return next((cv for cv in cvs if cv.lattes_id == q), None)
    exact = [cv for cv in cvs if normalize_name(cv.name) == normalize_name(q)]
    candidates = exact or [cv for cv in cvs if names_compatible(cv.name, q)]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        print(f"Warning: '{q}' matches {len(candidates)} researchers; use the Lattes ID instead:")
        for cv in candidates:
            print(f"  {cv.lattes_id or '(sem ID)'}  {cv.name}")
    return None

def generate_network_graph(cvs: List[CVData], output_file: str, zoom: float = 1.0, ignore_isolated: bool = False, target_researcher: str = None, target_custom_id: str = None):
    """
    Generates a network graph of researchers based on common publications.
    """
    # If target_custom_id is provided, filter the dataset to only include those researchers
    if target_custom_id:
        filtered_cvs = []
        for cv in cvs:
            if cv.custom_id:
                ids = [i.strip().lower() for i in cv.custom_id.split(',')]
                if target_custom_id.lower() in ids:
                    filtered_cvs.append(cv)
        print(f"Filtered dataset: {len(filtered_cvs)} researchers match custom ID '{target_custom_id}'")
        cvs = filtered_cvs

    try:
        import networkx as nx
        import matplotlib.pyplot as plt
    except ImportError:
        print("Error: 'networkx' and/or 'matplotlib' are not installed.")
        print("Please install them to generate the network graph (e.g., 'pip install networkx matplotlib').")
        return

    print("Generating network graph...")

    # Esqueletos (so nome, da importacao de uma proposta) nao tem publicacoes: seriam
    # nos soltos que so poluem o grafo.
    skeletons = [cv for cv in cvs if cv.skeleton]
    if skeletons:
        print(f"Left out {len(skeletons)} skeleton record(s) without CV data.")
    cvs = [cv for cv in cvs if not cv.skeleton]

    target_key = None
    if target_researcher:
        target = find_researcher(cvs, target_researcher)
        if target is None:
            print(f"Warning: Researcher '{target_researcher}' not found (or ambiguous) in the dataset.")
            return
        target_key = target.key

    G = nx.Graph()

    # O no e o pesquisador (ID Lattes), e o nome e so o rotulo: com o nome como no,
    # dois homonimos viravam um so e um sobrescrevia as publicacoes do outro.
    homonyms = {}
    for cv in cvs:
        homonyms.setdefault(normalize_name(cv.name), []).append(cv)

    researcher_pubs = {}
    for cv in cvs:
        label = cv.name
        if len(homonyms[normalize_name(cv.name)]) > 1 and cv.lattes_id:
            label = f"{cv.name} (ID ...{cv.lattes_id[-4:]})"
        pub_ids = set()
        for pub in cv.publications:
            pub_id = get_pub_id(pub)
            if pub_id:
                pub_ids.add(pub_id)

        researcher_pubs[cv.key] = pub_ids
        G.add_node(cv.key, label=textwrap.fill(label, width=15), num_pubs=len(pub_ids))

    # Find common publications and add edges
    for researcher1, researcher2 in combinations(researcher_pubs.keys(), 2):
        pubs1 = researcher_pubs[researcher1]
        pubs2 = researcher_pubs[researcher2]
        
        common_pubs = pubs1.intersection(pubs2)
        weight = len(common_pubs)
        
        if weight > 0:
            G.add_edge(researcher1, researcher2, weight=weight)
            
    if ignore_isolated:
        isolated_nodes = list(nx.isolates(G))
        if isolated_nodes:
            G.remove_nodes_from(isolated_nodes)
            print(f"Removed {len(isolated_nodes)} isolated nodes.")
            
    if target_key:
        if target_key in G.nodes():
            print(f"Producing ego network specifically for: {G.nodes[target_key]['label'].replace(chr(10), ' ')}")
            G = nx.ego_graph(G, target_key, radius=1)
        else:
            print(f"Warning: Researcher '{target_researcher}' has no common publications (removed as isolated).")
            return
            
    print(f"Graph generated: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges.")
    
    if G.number_of_nodes() == 0:
        print("No nodes to plot.")
        return

    # Plot the graph with a clean white theme
    fig, ax = plt.subplots(figsize=(20 * zoom, 20 * zoom))
    fig.patch.set_facecolor('#ffffff')
    ax.set_facecolor('#ffffff')
    
    import math
    for u, v, d in G.edges(data=True):
        # We logarithmically scale the weights. 
        # This prevents highly connected nodes from collapsing into a singularity,
        # while ensuring that single-connection nodes still feel a decent pull.
        d['scaled_weight'] = 1.0 + math.log10(d.get('weight', 1))
        
    # k=0.6 provides a good baseline optimal distance to prevent overlaps
    pos = nx.spring_layout(G, k=0.6, iterations=500, weight='scaled_weight')
    
    # Node sizes based on their degree
    degrees = dict(G.degree())
    node_sizes = [1500 + 400 * degrees.get(node, 0) for node in G.nodes()]
    
    # Color nodes based on their degree
    node_colors = [degrees.get(node, 0) for node in G.nodes()]
    
    # Edge widths based on weight
    edges = G.edges()
    weights = [G[u][v]['weight'] for u, v in edges]
    max_weight = max(weights) if weights else 1
    edge_widths = [1.5 + 5 * (w / max_weight) for w in weights]
    
    # Draw edges with a nice subtle color
    nx.draw_networkx_edges(
        G, pos, 
        edgelist=edges, 
        width=edge_widths, 
        alpha=0.3, 
        edge_color='#888888',
        ax=ax
    )
    
    # Draw nodes with a glowing effect
    nx.draw_networkx_nodes(
        G, pos, 
        node_size=[s * 1.6 for s in node_sizes], 
        node_color=node_colors, 
        cmap=plt.cm.plasma, 
        alpha=0.15,
        ax=ax
    )
    # Draw actual nodes
    nx.draw_networkx_nodes(
        G, pos, 
        node_size=node_sizes, 
        node_color=node_colors, 
        cmap=plt.cm.plasma, 
        alpha=0.95,
        edgecolors='#ffffff',
        linewidths=1.5,
        ax=ax
    )
    
    # Labels with clear typography
    labels = nx.draw_networkx_labels(
        G, pos,
        labels=nx.get_node_attributes(G, 'label'),
        font_size=18,
        font_family='sans-serif', 
        font_weight='bold',
        font_color='#222222',
        ax=ax
    )
    
    # Add a subtle background to labels for better readability
    for _, t in labels.items():
        t.set_bbox(dict(facecolor='#ffffff', alpha=0.75, edgecolor='none', boxstyle='round,pad=0.3'))
    
    plt.title("Rede de Colaboração (Publicações em Comum)", fontsize=32, color='#333333', fontweight='bold', pad=20)
    plt.axis("off")
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight', facecolor=fig.get_facecolor())
    print(f"Network graph saved to '{output_file}'.")
    # plt.show() # Commented out to prevent blocking in scripts

def main():
    parser = argparse.ArgumentParser(description="Read a JCRLattes JSON backup and summarize its CVs; --graph draws the collaboration network as an example of use")
    parser.add_argument("backup_file", nargs="?", default=None, help="Path to the exported jcr_lattes_database_backup.json file")
    parser.add_argument("--config", type=str, default="config.json", help="Path to a JSON configuration file specifying the arguments (default: config.json)")
    parser.add_argument("--graph", action="store_true", help="Generate a network graph of common publications")
    parser.add_argument("--graph-output", default="network_graph.png", help="Output file for the network graph image (default: network_graph.png)")
    parser.add_argument("--graph-zoom", type=float, default=1.0, help="Zoom level for the graph layout. Increase to spread nodes further apart (default: 1.0)")
    parser.add_argument("--ignore-isolated", action="store_true", help="Remove researchers with no common publications from the graph")
    parser.add_argument("--target-researcher", type=str, default=None, help="Produce the network only for the specified researcher and their direct connections")
    parser.add_argument("--target-custom-id", type=str, default=None, help="Filter the entire dataset to only include researchers matching the specified Custom ID")
    args = parser.parse_args()
    
    import os
    # Load from config file if provided or if default exists
    if args.config and os.path.exists(args.config):
        try:
            with open(args.config, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                
            # Override args with config data
            for key, value in config_data.items():
                if hasattr(args, key):
                    setattr(args, key, value)
        except Exception as e:
            print(f"Error reading config file '{args.config}': {e}")
            return
            
    if not args.backup_file:
        print("Error: backup_file must be provided either as a positional argument or inside the config file.")
        parser.print_help()
        return
    
    try:
        print(f"Loading backup from: {args.backup_file}")
        contents = load_backup(args.backup_file)
        parsed_cvs = contents.cvs
        print(f"Successfully loaded {len(parsed_cvs)} CVs from the database.")
        if contents.proposals:
            print(f"  {len(contents.proposals)} proposal record(s) (piccTools backup) were not counted as researchers.")
        if contents.skeletons:
            print(f"  {contents.skeletons} of the CVs are skeletons (name only, from a proposal import).")
        if contents.duplicates:
            print(f"  {contents.duplicates} repeated record(s) of the same Lattes ID were merged (newest full CV kept).")
        if contents.ignored:
            print(f"  {contents.ignored} unreadable record(s) ignored.")
        print()

        # Example processing: Print a summary for each CV
        for cv in parsed_cvs:
            print(f"[{cv.name}]" + (" (skeleton)" if cv.skeleton else ""))
            print(f"  URL: {cv.link}")
            if cv.custom_id:
                print(f"  Custom ID: {cv.custom_id}")
            print(f"  Publications: {len(cv.publications)}")
            print(f"  Patents: {len(cv.patents)}")
            print(f"  Events: {len(cv.events)}")
            print(f"  Supervisions: {len(cv.supervisions)}")
            
            wos_h = cv.raw_data.get('wosHIndex')
            rid_h = cv.raw_data.get('ridHIndex')
            if wos_h is not None or rid_h:
                print(f"  H-Index -> Lattes (WoS): {wos_h} | RID: {rid_h}")
                
            print("-" * 50)
            
        if args.graph:
            generate_network_graph(parsed_cvs, args.graph_output, args.graph_zoom, args.ignore_isolated, args.target_researcher, args.target_custom_id)
            
    except FileNotFoundError:
        print(f"Error: Could not find the file '{args.backup_file}'")
    except json.JSONDecodeError:
        print(f"Error: The file '{args.backup_file}' is not a valid JSON file.")

if __name__ == "__main__":
    main()
