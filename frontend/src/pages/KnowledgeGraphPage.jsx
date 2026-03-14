import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonChart } from '../components/Dashboard/SkeletonLoaders';
import { getDrugAEGraph } from '../services/api';

const NODE_COLORS = {
    drug: '#1D9E75',
    ae: '#EF9F27',
    outcome: '#8B5CF6',
};

const DRUG_FILTERS = [
    'metformin',
    'ozempic',
    'semaglutide',
    'wegovy',
    'liraglutide',
    'dulaglutide',
    'empagliflozin',
    'glipizide',
    'dapagliflozin',
    'sitagliptin',
    'januvia',
    'victoza',
    'trulicity',
    'jardiance',
];

function formatLabel(label) {
    return (label || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

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

function KnowledgeGraphPage() {
    const [graphData, setGraphData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedDrugs, setSelectedDrugs] = useState([]);
    const svgRef = useRef(null);
    const containerRef = useRef(null);

    const loadGraph = async () => {
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
    };

    useEffect(() => {
        loadGraph();
    }, []);

    useEffect(() => {
        if (!graphData || !svgRef.current || !containerRef.current) {
            return undefined;
        }

        const containerWidth = containerRef.current.clientWidth || 1100;
        const width = containerWidth;
        const height = 750;
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();
        svg.attr('viewBox', `0 0 ${width} ${height}`);

        const root = svg.append('g');
        svg.call(
            d3.zoom().scaleExtent([0.45, 2.4]).on('zoom', (event) => {
                root.attr('transform', event.transform);
            })
        );

        const links = graphData.edges.map((edge) => ({ ...edge }));
        const nodes = graphData.nodes.map((node) => ({ ...node }));
        const neighborMap = new Map();

        links.forEach((link) => {
            if (!neighborMap.has(link.source)) {
                neighborMap.set(link.source, new Set());
            }
            if (!neighborMap.has(link.target)) {
                neighborMap.set(link.target, new Set());
            }
            neighborMap.get(link.source).add(link.target);
            neighborMap.get(link.target).add(link.source);
        });

        const highlightedIds = new Set();
        const selectedDrugSet = new Set(selectedDrugs);
        if (selectedDrugSet.size) {
            selectedDrugSet.forEach((drug) => {
                highlightedIds.add(drug);
                (neighborMap.get(drug) || []).forEach((neighbor) => highlightedIds.add(neighbor));
            });
        }

        const simulation = d3
            .forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d) => d.id).distance(200).strength(0.28))
            .force('charge', d3.forceManyBody().strength(-800))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('x', d3.forceX(width / 2).strength(0.05))
            .force('y', d3.forceY(height / 2).strength(0.05))
            .force('collision', d3.forceCollide().radius((d) => (d.type === 'drug' ? 34 : d.type === 'outcome' ? 24 : 18)));

        const link = root
            .append('g')
            .attr('stroke', '#3A5A4D')
            .attr('stroke-opacity', 0.7)
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke-width', (d) => Math.max(1.4, Math.sqrt(d.weight || 1)));

        const node = root
            .append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .style('cursor', (d) => (d.type === 'drug' ? 'pointer' : 'default'))
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

        node
            .append('circle')
            .attr('r', (d) => (d.type === 'drug' ? 18 : d.type === 'outcome' ? 13 : 10))
            .attr('fill', (d) => NODE_COLORS[d.type] || NODE_COLORS.ae)
            .attr('stroke', '#EAF6F1')
            .attr('stroke-width', 1.3);

        node
            .append('text')
            .text((d) => formatLabel(d.label))
            .attr('fill', '#FFFFFF')
            .attr('font-size', (d) => (d.type === 'drug' ? 13 : 11))
            .attr('font-weight', (d) => (d.type === 'drug' ? 700 : 400))
            .attr('dx', 16)
            .attr('dy', 4)
            .attr('paint-order', 'stroke')
            .attr('stroke', 'rgba(10,31,26,0.25)')
            .attr('stroke-width', 0.3);

        node.each(function addLabelBackdrop() {
            const group = d3.select(this);
            const text = group.select('text');
            const bbox = text.node().getBBox();
            group
                .insert('rect', 'text')
                .attr('x', bbox.x - 6)
                .attr('y', bbox.y - 3)
                .attr('width', bbox.width + 12)
                .attr('height', bbox.height + 6)
                .attr('rx', 6)
                .attr('fill', 'rgba(8, 20, 18, 0.72)')
                .attr('stroke', 'rgba(255,255,255,0.08)')
                .attr('stroke-width', 0.8);
        });

        node.on('click', (_, clickedNode) => {
            if (clickedNode.type !== 'drug') {
                return;
            }
            setSelectedDrugs((current) =>
                current.includes(clickedNode.id)
                    ? current.filter((drug) => drug !== clickedNode.id)
                    : [...current, clickedNode.id]
            );
        });

        const dimOpacity = selectedDrugSet.size ? 0.1 : 1;

        node
            .transition()
            .duration(180)
            .style('opacity', (d) => (selectedDrugSet.size ? (highlightedIds.has(d.id) ? 1 : dimOpacity) : 1));

        link
            .transition()
            .duration(180)
            .style('opacity', (d) => {
                if (!selectedDrugSet.size) {
                    return 0.72;
                }
                return selectedDrugSet.has(d.source.id || d.source) || selectedDrugSet.has(d.target.id || d.target)
                    ? 0.95
                    : 0.1;
            });

        simulation.on('tick', () => {
            link
                .attr('x1', (d) => d.source.x)
                .attr('y1', (d) => d.source.y)
                .attr('x2', (d) => d.target.x)
                .attr('y2', (d) => d.target.y);

            node.attr('transform', (d) => `translate(${d.x},${d.y})`);
        });

        return () => {
            simulation.stop();
            svg.on('.zoom', null);
        };
    }, [graphData, selectedDrugs]);

    const stats = useMemo(() => {
        const fallback = { drug_nodes: 0, ae_nodes: 0, total_edges: 0 };
        return graphData?.stats || fallback;
    }, [graphData]);

    const toggleDrug = (drug) => {
        setSelectedDrugs((current) =>
            current.includes(drug)
                ? current.filter((entry) => entry !== drug)
                : [...current, drug]
        );
    };

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-di-text">Medication Side Effect Network</h1>
                        <p className="mt-1 text-sm text-di-text-secondary">
                            Explore connections between medications and their reported side effects. Click any node to focus on its relationships. Double-click the background to reset.
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-di-text-secondary">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.drug }} />
                            <span>Medication</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.ae }} />
                            <span>Side Effect</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.outcome }} />
                            <span>Outcome</span>
                        </div>
                    </div>
                </div>

                <div className="di-card">
                    <div className="mb-4 flex flex-wrap gap-2">
                        {DRUG_FILTERS.map((drug) => {
                            const isActive = selectedDrugs.includes(drug);
                            return (
                                <button
                                    key={drug}
                                    type="button"
                                    onClick={() => toggleDrug(drug)}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                        isActive
                                            ? 'border-di-accent bg-di-accent/10 text-di-accent'
                                            : 'border-di-border bg-di-bg/60 text-di-text-secondary hover:border-di-accent/40 hover:text-di-text'
                                    }`}
                                >
                                    {formatLabel(drug)}
                                </button>
                            );
                        })}
                    </div>

                    {error ? (
                        <ErrorCard error={error} onRetry={loadGraph} />
                    ) : loading && !graphData ? (
                        <SkeletonChart height="h-[750px]" />
                    ) : (
                        <div ref={containerRef} className="h-[750px] w-full overflow-hidden rounded-xl bg-di-bg/50">
                            <svg ref={svgRef} className="h-full w-full" />
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold" style={{ color: NODE_COLORS.drug }}>{stats.drug_nodes || 0}</div>
                        <div className="mt-1 text-sm text-di-text-secondary">Medications</div>
                    </div>
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold" style={{ color: NODE_COLORS.ae }}>{stats.ae_nodes || 0}</div>
                        <div className="mt-1 text-sm text-di-text-secondary">Side Effects</div>
                    </div>
                    <div className="di-card text-center">
                        <div className="text-3xl font-bold text-di-text">{stats.total_edges || 0}</div>
                        <div className="mt-1 text-sm text-di-text-secondary">Reported Connections</div>
                    </div>
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default KnowledgeGraphPage;
