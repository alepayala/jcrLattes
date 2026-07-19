import json
import argparse
import re
import textwrap
from typing import List, Dict, Any
from dataclasses import dataclass
from itertools import combinations

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

def parse_jcr_backup(file_path: str) -> List[CVData]:
    """
    Reads the JSON backup file and converts it into a list of CVData structures.
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    cvs = []
    
    # Handle different possible JSON export structures (list vs dict)
    if isinstance(data, dict):
        if 'jcrLattesCVs' in data:
            entries = data['jcrLattesCVs'].values()
        else:
            entries = data.values()
    else:
        entries = data

    for entry in entries:
        # Backward compatibility with older exports
        name_link = entry.get('nameLink', {})
        
        name = entry.get('name') or name_link.get('name', 'Unknown Researcher')
        lattes_id = entry.get('lattesId') or name_link.get('lattesId', '')
        custom_id = entry.get('customId', '')
        
        if lattes_id:
            link = f"http://lattes.cnpq.br/{lattes_id}"
        else:
            link = name_link.get('link', 'No Link')
        
        # Handle supervisions structure
        raw_supervisions = entry.get('supervisions', [])
        if isinstance(raw_supervisions, dict) and 'raw' in raw_supervisions:
            sups_list = raw_supervisions.get('raw', [])
        else:
            sups_list = raw_supervisions if isinstance(raw_supervisions, list) else []

        cv = CVData(
            name=name,
            lattes_id=lattes_id,
            custom_id=custom_id,
            link=link,
            publications=entry.get('publications', []),
            patents=entry.get('rawPatents', entry.get('patents', [])),
            events=entry.get('rawEvents', entry.get('events', [])),
            supervisions=sups_list,
            declared_citations=entry.get('declaredCitations', {}),
            date_added=entry.get('dateAdded', 'Unknown Date'),
            raw_data=entry
        )
        cvs.append(cv)
        
    return cvs

def get_pub_id(pub: Dict[str, Any]) -> str:
    """
    Returns a unique identifier for a publication.
    Prefers DOI; falls back to normalized reference text.
    """
    doi = pub.get('doi')
    if doi:
        return doi.strip().lower()
    
    ref = pub.get('reference', '')
    # Normalize reference: alphanumeric only, lowercase
    return re.sub(r'\W+', '', ref).lower()

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
    
    G = nx.Graph()
    
    # Map researcher names to a set of their publication IDs
    researcher_pubs = {}
    for cv in cvs:
        node_name = textwrap.fill(cv.name, width=15)
        pub_ids = set()
        for pub in cv.publications:
            pub_id = get_pub_id(pub)
            if pub_id:
                pub_ids.add(pub_id)
        
        researcher_pubs[node_name] = pub_ids
        G.add_node(node_name, num_pubs=len(pub_ids))

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
            
    if target_researcher:
        target_node = None
        for node in G.nodes():
            if target_researcher.lower() in node.replace('\n', ' ').lower():
                target_node = node
                break
                
        if target_node and target_node in G.nodes():
            print(f"Producing ego network specifically for: {target_node.replace(chr(10), ' ')}")
            G = nx.ego_graph(G, target_node, radius=1)
        else:
            print(f"Warning: Researcher with name '{target_researcher}' not found in the plotted network.")
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
    parser = argparse.ArgumentParser(description="Parse JCR Lattes JSON Database Backup")
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
        parsed_cvs = parse_jcr_backup(args.backup_file)
        print(f"Successfully loaded {len(parsed_cvs)} CVs from the database.\n")
        
        # Example processing: Print a summary for each CV
        for cv in parsed_cvs:
            print(f"[{cv.name}]")
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
