import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonChart } from '../components/Dashboard/SkeletonLoaders';
import { getDrugAEGraph } from '../services/api';

/* ============================================================
   Constants & Design Tokens
   ============================================================ */
const NODE_COLORS = {
    drug: '#00C896',
    ae: '#EF9F27',
    outcome: '#8B5CF6',
};

const DRUG_GLOW = 'rgba(0, 200, 150, 0.6)';
const AE_GLOW = 'rgba(239, 159, 39, 0.4)';
const EDGE_DEFAULT = '#1E3A2F';
const EDGE_HIGHLIGHT = '#00E5A0';
const CANVAS_BG = '#070F0C';

// Generic → brand display names (mirrors backend DRUG_DISPLAY_NAMES)
const DRUG_DISPLAY = {
    metformin: 'Metformin',
    semaglutide: 'Ozempic',
    empagliflozin: 'Jardiance',
    sitagliptin: 'Januvia',
    dapagliflozin: 'Farxiga',
    dulaglutide: 'Trulicity',
    liraglutide: 'Victoza',
    glipizide: 'Glipizide',
};

const DRUG_RADIUS = 28;
const AE_RADIUS = 8;
const LABEL_FONT = 11;

/* ============================================================
   Helpers
   ============================================================ */
function capitalize(s) {
    if (!s) return '';
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayLabel(node) {
    if (node.type === 'drug') {
        return DRUG_DISPLAY[node.id] || capitalize(node.id);
    }
    return capitalize(node.label || node.id);
}

/* ============================================================
   Error Card (unchanged)
   ============================================================ */
function ErrorCard({ error, onRetry }) {
    return (
        <div className="di-card">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="di-section-title mb-1">Medication Side Effect Network</h2>
                    <p className="text-sm text-di-text-secondary">{error || 'Failed to load graph data.'}</p>
                </div>
                <button type="button" className="di-btn-secondary" onClick={onRetry}>
                    Retry
                </button>
            </div>
        </div>
    );
}

/* ============================================================
   Drug Pill Button
   ============================================================ */
function DrugPill({ nodeId, isActive, onClick }) {
    const label = DRUG_DISPLAY[nodeId] || capitalize(nodeId);
    return (
        <button
            type="button"
            onClick={() => onClick(nodeId)}
            className="transition-all duration-200 whitespace-nowrap"
            style={{
                padding: '6px 16px',
                borderRadius: '9999px',
                fontSize: '13px',
                fontWeight: 600,
                border: isActive ? '1.5px solid #00C896' : '1.5px solid #1E3A2F',
                background: isActive ? 'rgba(0, 200, 150, 0.15)' : 'rgba(17, 40, 32, 0.7)',
                color: isActive ? '#00E5A0' : '#8BA89E',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
            }}
        >
            {label}
        </button>
    );
}

/* ============================================================
   Node Info Panel — overlay inside graph canvas
   ============================================================ */
function NodeInfoPanel({ node, neighborCount, onClear }) {
    if (!node) return null;

    const label = displayLabel(node);
    const typeLabel = node.type === 'drug' ? 'Medication' : node.type === 'outcome' ? 'Outcome' : 'Side Effect';
    const badgeColor = node.type === 'drug' ? NODE_COLORS.drug : node.type === 'outcome' ? NODE_COLORS.outcome : NODE_COLORS.ae;

    let connectionText;
    if (node.type === 'drug') {
        connectionText = `Connected to ${neighborCount} side effect${neighborCount !== 1 ? 's' : ''}`;
    } else {
        connectionText = `Reported with ${neighborCount} medication${neighborCount !== 1 ? 's' : ''}`;
    }

    return (
        <div
            style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                background: 'rgba(10, 25, 18, 0.95)',
                border: '1px solid rgba(0, 200, 150, 0.3)',
                borderRadius: '10px',
                padding: '12px 16px',
                minWidth: '180px',
                color: 'white',
                fontSize: '13px',
                zIndex: 10,
                pointerEvents: 'auto',
                backdropFilter: 'blur(8px)',
            }}
        >
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px', color: '#FFFFFF' }}>
                {label}
            </div>
            <div style={{ marginBottom: '6px' }}>
                <span
                    style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: `${badgeColor}22`,
                        color: badgeColor,
                    }}
                >
                    {typeLabel}
                </span>
            </div>
            <div style={{ color: '#8BA89E', fontSize: '12px', marginBottom: '8px' }}>
                {connectionText}
            </div>
            <div style={{ textAlign: 'right' }}>
                <button
                    type="button"
                    onClick={onClear}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#00C896',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                        padding: '2px 4px',
                    }}
                >
                    ✕ Clear
                </button>
            </div>
        </div>
    );
}

/* ============================================================
   Main Page Component
   ============================================================ */
function KnowledgeGraphPage() {
    const [graphData, setGraphData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedDrug, setSelectedDrug] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    const simulationRef = useRef(null);

    /* ---------- data loading ---------- */
    const loadGraph = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await getDrugAEGraph();
            setGraphData(response.data);
        } catch (requestError) {
            setError(requestError.response?.data?.detail || requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadGraph();
    }, [loadGraph]);

    /* ---------- memoized drug list for pills ---------- */
    const drugNodes = useMemo(() => {
        if (!graphData) return [];
        return graphData.nodes
            .filter((n) => n.type === 'drug')
            .sort((a, b) => (b.size || 0) - (a.size || 0));
    }, [graphData]);

    /* ---------- neighbor map (built once) ---------- */
    const neighborMap = useMemo(() => {
        if (!graphData) return new Map();
        const map = new Map();
        graphData.edges.forEach((edge) => {
            const s = typeof edge.source === 'object' ? edge.source.id : edge.source;
            const t = typeof edge.target === 'object' ? edge.target.id : edge.target;
            if (!map.has(s)) map.set(s, new Set());
            if (!map.has(t)) map.set(t, new Set());
            map.get(s).add(t);
            map.get(t).add(s);
        });
        return map;
    }, [graphData]);

    /* ---------- node type lookup ---------- */
    const nodeTypeMap = useMemo(() => {
        if (!graphData) return new Map();
        const map = new Map();
        graphData.nodes.forEach((n) => map.set(n.id, n.type));
        return map;
    }, [graphData]);

    /* ---------- pill click handler ---------- */
    const handlePillClick = useCallback(
        (drugId) => {
            setSelectedNode(null); // clear node selection when pill is clicked
            setSelectedDrug((prev) => (prev === drugId ? null : drugId));
        },
        []
    );

    /* ---------- clear node selection ---------- */
    const handleClearNode = useCallback(() => {
        setSelectedNode(null);
    }, []);

    /* ---------- info panel data ---------- */
    const selectedNodeData = useMemo(() => {
        if (!selectedNode || !graphData) return null;
        return graphData.nodes.find((n) => n.id === selectedNode) || null;
    }, [selectedNode, graphData]);

    const selectedNodeNeighborCount = useMemo(() => {
        if (!selectedNode) return 0;
        return neighborMap.get(selectedNode)?.size || 0;
    }, [selectedNode, neighborMap]);

    /* ============================================================
       D3 Force Graph — runs when graphData changes
       ============================================================ */
    useEffect(() => {
        if (!graphData || !svgRef.current || !containerRef.current) return undefined;

        const containerWidth = containerRef.current.clientWidth || 960;
        const width = containerWidth;
        const height = 620;
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();
        svg.attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'xMidYMid meet');

        /* -- defs for glow filter -- */
        const defs = svg.append('defs');
        const glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
        glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
        const feMerge = glowFilter.append('feMerge');
        feMerge.append('feMergeNode').attr('in', 'blur');
        feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

        /* -- root group for zoom -- */
        const root = svg.append('g');
        svg.call(
            d3
                .zoom()
                .scaleExtent([0.3, 3])
                .on('zoom', (event) => root.attr('transform', event.transform))
        );

        /* -- data copies -- */
        const links = graphData.edges.map((e) => ({ ...e }));
        const nodes = graphData.nodes.map((n) => ({ ...n }));

        const drugCount = nodes.filter((n) => n.type === 'drug').length;
        const aeCount = nodes.filter((n) => n.type !== 'drug').length;
        const totalNodes = nodes.length;

        /* ============================================================
           Force simulation — values calculated from actual node counts
           ============================================================ */
        // Charge: spread enough so drugs are at least 150px apart
        // With N drugs in a ~width area, we need strong repulsion
        const chargeStrength = -Math.max(350, 800 * (30 / Math.max(totalNodes, 1)));
        // Link distance: enough room for labels
        const linkDist = Math.max(100, Math.min(180, width / (drugCount + 1)));
        // Collision: drug nodes need >> radius to keep labels from overlapping
        const collisionRadius = (d) => (d.type === 'drug' ? DRUG_RADIUS + 35 : AE_RADIUS + 22);

        const simulation = d3
            .forceSimulation(nodes)
            .force(
                'link',
                d3
                    .forceLink(links)
                    .id((d) => d.id)
                    .distance((d) => {
                        if (d.type === 'drug_combination') return linkDist * 0.7;
                        return linkDist;
                    })
                    .strength(0.7)
            )
            .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(500))
            .force('x', d3.forceX(width / 2).strength(0.07))
            .force('y', d3.forceY(height / 2).strength(0.07))
            .force('collision', d3.forceCollide().radius(collisionRadius).strength(0.9))
            .stop();

        // Pre-run simulation so graph renders already spread out
        const tickCount = Math.ceil(Math.log(totalNodes + 1) * 80);
        for (let i = 0; i < tickCount; i++) simulation.tick();

        simulationRef.current = simulation;

        /* -- draw edges -- */
        const linkGroup = root.append('g').attr('class', 'links');
        const link = linkGroup
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', EDGE_DEFAULT)
            .attr('stroke-opacity', 0.5)
            .attr('stroke-width', (d) => Math.max(1, Math.min(4, Math.sqrt(d.weight || 1))))
            .attr('x1', (d) => d.source.x)
            .attr('y1', (d) => d.source.y)
            .attr('x2', (d) => d.target.x)
            .attr('y2', (d) => d.target.y);

        /* -- draw nodes -- */
        const nodeGroup = root.append('g').attr('class', 'nodes');
        const node = nodeGroup
            .selectAll('g')
            .data(nodes)
            .join('g')
            .attr('transform', (d) => `translate(${d.x},${d.y})`)
            .style('cursor', 'pointer')
            .call(
                d3
                    .drag()
                    .on('start', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    })
                    .on('drag', (event, d) => {
                        d.fx = event.x;
                        d.fy = event.y;
                    })
                    .on('end', (event, d) => {
                        if (!event.active) simulation.alphaTarget(0);
                        d.fx = null;
                        d.fy = null;
                    })
            );

        /* -- node circles -- */
        node
            .append('circle')
            .attr('r', (d) => (d.type === 'drug' ? DRUG_RADIUS : d.type === 'outcome' ? 12 : AE_RADIUS))
            .attr('fill', (d) => {
                if (d.type === 'drug') return NODE_COLORS.drug;
                if (d.type === 'outcome') return NODE_COLORS.outcome;
                return NODE_COLORS.ae;
            })
            .attr('stroke', (d) => (d.type === 'drug' ? DRUG_GLOW : 'rgba(255,255,255,0.1)'))
            .attr('stroke-width', (d) => (d.type === 'drug' ? 2.5 : 1))
            .attr('filter', (d) => (d.type === 'drug' ? 'url(#glow)' : null));

        /* -- DRUG labels — inside the circle, centered -- */
        node
            .filter((d) => d.type === 'drug')
            .append('text')
            .text((d) => displayLabel(d))
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', '#FFFFFF')
            .attr('font-size', 10)
            .attr('font-weight', 700)
            .attr('pointer-events', 'none');

        /* -- AE/Outcome labels — to the right with dark bg rect -- */
        const aeLabels = node.filter((d) => d.type !== 'drug');

        // background rect
        aeLabels
            .append('rect')
            .attr('class', 'label-bg')
            .attr('rx', 3)
            .attr('ry', 3)
            .attr('fill', 'rgba(7, 15, 12, 0.85)')
            .attr('stroke', 'rgba(30, 58, 47, 0.5)')
            .attr('stroke-width', 0.5);

        // text
        aeLabels
            .append('text')
            .attr('class', 'ae-label')
            .text((d) => displayLabel(d))
            .attr('x', (d) => (d.type === 'outcome' ? 16 : AE_RADIUS + 6))
            .attr('dy', '0.35em')
            .attr('fill', '#C8D8D0')
            .attr('font-size', LABEL_FONT)
            .attr('pointer-events', 'none');

        // size the bg rect after text is rendered
        aeLabels.each(function () {
            const g = d3.select(this);
            const textEl = g.select('text.ae-label');
            const bgRect = g.select('rect.label-bg');
            const bbox = textEl.node().getBBox();
            bgRect
                .attr('x', bbox.x - 3)
                .attr('y', bbox.y - 2)
                .attr('width', bbox.width + 6)
                .attr('height', bbox.height + 4);
        });

        /* -- tooltip -- */
        const tooltip = d3
            .select(containerRef.current)
            .append('div')
            .style('position', 'absolute')
            .style('pointer-events', 'none')
            .style('background', 'rgba(7, 15, 12, 0.95)')
            .style('border', '1px solid #1E3A2F')
            .style('border-radius', '8px')
            .style('padding', '8px 12px')
            .style('font-size', '12px')
            .style('color', '#FFFFFF')
            .style('opacity', 0)
            .style('z-index', 10)
            .style('backdrop-filter', 'blur(8px)');

        node
            .on('mouseenter', (event, d) => {
                const label = displayLabel(d);
                const typeLabel = d.type === 'drug' ? 'Medication' : d.type === 'outcome' ? 'Outcome' : 'Side Effect';
                const connections = neighborMap.get(d.id)?.size || 0;
                tooltip
                    .html(
                        `<div style="font-weight:700;color:${NODE_COLORS[d.type] || '#fff'}">${label}</div>` +
                        `<div style="color:#8BA89E;margin-top:2px">${typeLabel} · ${connections} connection${connections !== 1 ? 's' : ''}</div>`
                    )
                    .style('opacity', 1)
                    .style('left', `${event.offsetX + 14}px`)
                    .style('top', `${event.offsetY - 10}px`);
            })
            .on('mousemove', (event) => {
                tooltip.style('left', `${event.offsetX + 14}px`).style('top', `${event.offsetY - 10}px`);
            })
            .on('mouseleave', () => {
                tooltip.style('opacity', 0);
            });

        /* ============================================================
           Unified Highlighting Logic
           Supports two modes:
             1. Node click (selectedNode) — any node, shows all neighbors
             2. Pill filter (selectedDrug) — drug-only, shows AE neighbors
           Node click takes priority when both are set.
           ============================================================ */
        const applyHighlight = (activeNodeId, activeDrugId) => {
            // Determine which mode we're in
            const focusId = activeNodeId || activeDrugId;

            if (!focusId) {
                // Reset all
                node.transition().duration(250)
                    .style('opacity', 1)
                    .attr('transform', (d) => `translate(${d.x},${d.y})`);
                link.transition().duration(250)
                    .attr('stroke', EDGE_DEFAULT)
                    .attr('stroke-opacity', 0.5)
                    .attr('stroke-width', (d) => Math.max(1, Math.min(4, Math.sqrt(d.weight || 1))))
                    .attr('filter', null);
                return;
            }

            // Build the set of visible neighbor IDs
            const connectedIds = new Set();
            const nbs = neighborMap.get(focusId);
            if (nbs) {
                if (activeNodeId) {
                    // Node click mode: show ALL direct neighbors
                    nbs.forEach((nbId) => connectedIds.add(nbId));
                } else {
                    // Pill mode: only show non-drug neighbors
                    nbs.forEach((nbId) => {
                        const nbType = nodeTypeMap.get(nbId);
                        if (nbType !== 'drug') connectedIds.add(nbId);
                    });
                }
            }

            // Nodes: focused node + its connections bright, everything else dim
            node.transition().duration(250)
                .style('opacity', (d) => {
                    if (d.id === focusId) return 1;
                    if (connectedIds.has(d.id)) return 1;
                    return 0.05;
                })
                .attr('transform', (d) => {
                    if (d.id === focusId && activeNodeId) {
                        return `translate(${d.x},${d.y}) scale(1.2)`;
                    }
                    return `translate(${d.x},${d.y})`;
                });

            // Edges: connected edges glow, others nearly invisible
            link.transition().duration(250)
                .attr('stroke', (d) => {
                    const sId = typeof d.source === 'object' ? d.source.id : d.source;
                    const tId = typeof d.target === 'object' ? d.target.id : d.target;
                    if (sId === focusId || tId === focusId) {
                        const otherId = sId === focusId ? tId : sId;
                        if (connectedIds.has(otherId)) return EDGE_HIGHLIGHT;
                    }
                    return EDGE_DEFAULT;
                })
                .attr('stroke-opacity', (d) => {
                    const sId = typeof d.source === 'object' ? d.source.id : d.source;
                    const tId = typeof d.target === 'object' ? d.target.id : d.target;
                    if (sId === focusId || tId === focusId) {
                        const otherId = sId === focusId ? tId : sId;
                        if (connectedIds.has(otherId)) return 1;
                    }
                    return 0.03;
                })
                .attr('stroke-width', (d) => {
                    const sId = typeof d.source === 'object' ? d.source.id : d.source;
                    const tId = typeof d.target === 'object' ? d.target.id : d.target;
                    if (sId === focusId || tId === focusId) {
                        const otherId = sId === focusId ? tId : sId;
                        if (connectedIds.has(otherId)) return 2;
                    }
                    return Math.max(1, Math.sqrt(d.weight || 1));
                })
                .attr('filter', (d) => {
                    const sId = typeof d.source === 'object' ? d.source.id : d.source;
                    const tId = typeof d.target === 'object' ? d.target.id : d.target;
                    if (sId === focusId || tId === focusId) {
                        const otherId = sId === focusId ? tId : sId;
                        if (connectedIds.has(otherId)) return 'url(#glow)';
                    }
                    return null;
                });
        };

        /* -- node click: isolate any node (drug OR AE) -- */
        node.on('click', (event, d) => {
            event.stopPropagation();
            setSelectedNode((prev) => (prev === d.id ? null : d.id));
        });

        /* -- double-click canvas to reset -- */
        svg.on('dblclick.reset', () => {
            setSelectedNode(null);
            setSelectedDrug(null);
        });

        /* -- tick handler (for drag) -- */
        simulation.on('tick', () => {
            link
                .attr('x1', (d) => d.source.x)
                .attr('y1', (d) => d.source.y)
                .attr('x2', (d) => d.target.x)
                .attr('y2', (d) => d.target.y);
            node.attr('transform', (d) => `translate(${d.x},${d.y})`);
        });

        /* -- store applyHighlight for React effects -- */
        svgRef.current._applyHighlight = applyHighlight;

        /* -- cleanup -- */
        return () => {
            simulation.stop();
            svg.on('.zoom', null);
            svg.on('dblclick.reset', null);
            tooltip.remove();
        };
    }, [graphData, neighborMap, nodeTypeMap]);

    /* ---------- react to selectedNode / selectedDrug changes ---------- */
    useEffect(() => {
        if (svgRef.current?._applyHighlight) {
            // Node click takes priority over pill filter
            svgRef.current._applyHighlight(selectedNode, selectedDrug);
        }
    }, [selectedNode, selectedDrug]);

    /* ---------- stats ---------- */
    const stats = useMemo(() => {
        const fallback = { drug_nodes: 0, ae_nodes: 0, total_edges: 0 };
        return graphData?.stats || fallback;
    }, [graphData]);

    /* ============================================================
       Render
       ============================================================ */
    return (
        <ErrorBoundary>
            <div className="space-y-5 animate-fade-in">
                {/* Header */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-di-text">Medication Side Effect Network</h1>
                        <p className="mt-1 text-sm text-di-text-secondary">
                            Explore connections between medications and their reported side effects from patient discussions.
                            Click a pill or node to focus. Double-click background to reset.
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-di-text-secondary">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.drug, boxShadow: `0 0 6px ${DRUG_GLOW}` }} />
                            <span>Medication</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.ae }} />
                            <span>Side Effect</span>
                        </div>
                    </div>
                </div>

                {/* Drug Pill Filters */}
                {drugNodes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {drugNodes.map((n) => (
                            <DrugPill key={n.id} nodeId={n.id} isActive={selectedDrug === n.id} onClick={handlePillClick} />
                        ))}
                    </div>
                )}

                {/* Graph Canvas */}
                {error ? (
                    <ErrorCard error={error} onRetry={loadGraph} />
                ) : loading && !graphData ? (
                    <SkeletonChart height="h-[620px]" />
                ) : (
                    <div className="di-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div
                            ref={containerRef}
                            className="w-full overflow-hidden rounded-xl"
                            style={{
                                height: '620px',
                                background: `radial-gradient(ellipse at center, ${CANVAS_BG} 0%, #040907 100%)`,
                                position: 'relative',
                            }}
                        >
                            <svg ref={svgRef} className="h-full w-full" />
                            <NodeInfoPanel
                                node={selectedNodeData}
                                neighborCount={selectedNodeNeighborCount}
                                nodeTypeMap={nodeTypeMap}
                                onClear={handleClearNode}
                            />
                        </div>
                    </div>
                )}

                {/* Stats Bar */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold" style={{ color: NODE_COLORS.drug }}>
                            {stats.drug_nodes || 0}
                        </div>
                        <div className="mt-1 text-sm text-di-text-secondary">Medications</div>
                    </div>
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold" style={{ color: NODE_COLORS.ae }}>
                            {stats.ae_nodes || 0}
                        </div>
                        <div className="mt-1 text-sm text-di-text-secondary">Side Effects</div>
                    </div>
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold text-di-text">{stats.total_edges || 0}</div>
                        <div className="mt-1 text-sm text-di-text-secondary">Total Connections</div>
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default KnowledgeGraphPage;
