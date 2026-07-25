import { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  Handle,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import dagre from "dagre";
import "reactflow/dist/style.css";
import type { UiGraph, UiGraphNode } from "./types";

const nodeWidth = 200;
const nodeHeight = 72;

function GraphNode({ data }: NodeProps<{ node: UiGraphNode }>) {
  const { node } = data;
  return (
    <div className={`graph-node ${node.kind}${node.severity ? ` ${node.severity}` : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="kind">{node.kind}</div>
      <strong>{node.label}</strong>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { doctor: GraphNode };

function layout(graph: UiGraph): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 70 });

  for (const node of graph.nodes)
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  for (const edge of graph.edges) dagreGraph.setEdge(edge.source, edge.target);
  dagre.layout(dagreGraph);

  const nodes: Node[] = graph.nodes.map((node) => {
    const position = dagreGraph.node(node.id);
    return {
      id: node.id,
      type: "doctor",
      position: {
        x: (position?.x ?? 0) - nodeWidth / 2,
        y: (position?.y ?? 0) - nodeHeight / 2,
      },
      data: { node },
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: edge.severity === "error" ? { stroke: "var(--error)" } : undefined,
  }));

  return { nodes, edges };
}

export function GraphView({ title, graph }: { title: string; graph: UiGraph }) {
  const laidOut = useMemo(() => layout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laidOut.edges);

  useEffect(() => {
    setNodes(laidOut.nodes);
    setEdges(laidOut.edges);
  }, [laidOut, setNodes, setEdges]);

  if (graph.nodes.length === 0)
    return (
      <section className="panel">
        <h2>{title}</h2>
        <p className="muted">No graph data for this report.</p>
      </section>
    );

  return (
    <section>
      <h2>{title}</h2>
      <div className="graph-shell">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
