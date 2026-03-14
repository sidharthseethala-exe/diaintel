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

const cleanLabel = (str) => str
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .replace(/'\s*\w/g, (c) => c.toLowerCase());

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
        const zoomBehavior = d3
            .zoom()
            .scaleExtent([0.45, 2.4])
            .on('zoom', (event) => {
                root.attr('transform', event.transform);
            });

        svg.call(zoomBehavior);
        svg.on('dblclick.zoom', null);
        svg.on('dblclick', () => {
            setSelectedDrugs([]);
            svg.transition().duration(250).call(zoomBehavior.transform, d3.zoomIdentity);
        });

        const links = graphData.edges.map((edge) => ({ ...edge }));
        const nodes = graphData.nodes.map((node) => ({ ...node }));
        const neighborMap = new Map();

        links.forEach((link) => {
            const sourceId = link.source.id || link.source;
            const targetId = link.target.id || link.target;
            if (!neighborMap.has(sourceId)) {
                neighborMap.set(sourceId, new Set());
            }
            if (!neighborMap.has(targetId)) {
                neighborMap.set(targetId, new Set());
            }
            neighborMap.get(sourceId).add(targetId);
            neighborMap.get(targetId).add(sourceId);
        });

        const selectedDrugSet = new Set(selectedDrugs);
        const highlightedIds = new Set();
        if (selectedDrugSet.size) {
            selectedDrugSet.forEach((drug) => {
                highlightedIds.add(drug);
                (neighborMap.get(drug) || []).forEach((neighbor) => highlightedIds.add(neighbor));
            });
        }

        const simulation = d3
            .forceSimulation(nodes)
            .force(
                'link',
                d3.forceLink(links)
                    .id((d) => d.id)
                    .distance((d) => (d.type === 'drug_ae' ? 250 : d.type === 'drug_combination' ? 180 : 210))
                    .strength(0.22)
            )
            .force('charge', d3.forceManyBody().strength(-1500))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('x', d3.forceX(width / 2).strength(0.08))
            .force('y', d3.forceY(height / 2).strength(0.04))
            .force('collision', d3.forceCollide().radius((d) => (d.type === 'drug' ? 40 : d.type === 'ae' ? 22 : 28)));

        const link = root
            .append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', '#2a6b52')
            .attr('stroke-opacity', 0.85)
            .attr('stroke-width', (d) => Math.max(0.5, Math.sqrt(d.weight || 1) * 0.4));

        const node = root
            .append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .style('cursor', (d) => (d.type === 'drug' ? 'pointer' : 'grab'))
            .call(
                d3
                    .drag()
                    .on('start', (event, d) => {
                        if (!event.active) {
                            simulation.alphaTarget(0.3).restart();
                        }
                        d.fx = d.x;
                        d.fy = d.y;
                    })
                    .on('drag', (event, d) => {
                        d.fx = event.x;
                        d.fy = event.y;
                    })
                    .on('end', (event, d) => {
                        if (!event.active) {
                            simulation.alphaTarget(0);
                        }
                        d.fx = null;
                        d.fy = null;
                    })
            );

        node
            .append('circle')
            .attr('r', (d) => (d.type === 'drug' ? 20 : d.type === 'outcome' ? 12 : 10))
            .attr('fill', (d) => NODE_COLORS[d.type] || NODE_COLORS.ae)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', (d) => (d.type === 'drug' ? 1.5 : d.type === 'outcome' ? 1 : 0.8));

        node.each(function addLabelElements(d) {
            const group = d3.select(this);
            const label = cleanLabel(d.label);
            const fontSize = d.type === 'drug' ? 13 : 11;
            const rectWidth = label.length * 7;

            group
                .append('rect')
                .attr('x', 14)
                .attr('y', -8)
                .attr('width', rectWidth)
                .attr('height', 16)
                .attr('rx', 3)
                .attr('fill', '#0d1f18')
                .attr('opacity', 0.75);

            group
                .append('text')
                .text(label)
                .attr('fill', '#FFFFFF')
                .attr('font-size', fontSize)
                .attr('font-weight', d.type === 'drug' ? 700 : 400)
                .attr('dx', 18)
                .attr('dy', 4);
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

        node
            .transition()
            .duration(180)
            .style('opacity', (d) => {
                if (!selectedDrugSet.size) {
                    return 1;
                }
                return highlightedIds.has(d.id) ? 1 : 0.08;
            });

        link
            .transition()
            .duration(180)
            .attr('stroke', (d) => {
                if (!selectedDrugSet.size) {
                    return '#2a6b52';
                }
                const sourceId = d.source.id || d.source;
                const targetId = d.target.id || d.target;
                return selectedDrugSet.has(sourceId) || selectedDrugSet.has(targetId) ? '#00C896' : '#2a6b52';
            })
            .attr('stroke-width', (d) => {
                if (!selectedDrugSet.size) {
                    return Math.max(0.5, Math.sqrt(d.weight || 1) * 0.4);
                }
                const sourceId = d.source.id || d.source;
                const targetId = d.target.id || d.target;
                return selectedDrugSet.has(sourceId) || selectedDrugSet.has(targetId)
                    ? 2
                    : Math.max(0.5, Math.sqrt(d.weight || 1) * 0.4);
            })
            .style('opacity', (d) => {
                if (!selectedDrugSet.size) {
                    return 0.85;
                }
                const sourceId = d.source.id || d.source;
                const targetId = d.target.id || d.target;
                return selectedDrugSet.has(sourceId) || selectedDrugSet.has(targetId) ? 1 : 0.08;
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
            svg.on('dblclick', null);
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
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        {DRUG_FILTERS.map((drug) => {
                            const isActive = selectedDrugs.includes(drug);
                            return (
                                <button
                                    key={drug}
                                    type="button"
                                    onClick={() => toggleDrug(drug)}
                                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                                    style={
                                        isActive
                                            ? {
                                                  background: 'rgba(0,200,150,0.15)',
                                                  border: '2px solid #00C896',
                                                  color: '#00C896',
                                                  fontWeight: 700,
                                              }
                                            : {
                                                  background: 'transparent',
                                                  border: '1px solid rgba(255,255,255,0.15)',
                                                  color: 'rgba(255,255,255,0.6)',
                                              }
                                    }
                                >
                                    {cleanLabel(drug)}
                                </button>
                            );
                        })}
                        {selectedDrugs.length ? (
                            <button
                                type="button"
                                onClick={() => setSelectedDrugs([])}
                                className="rounded-full px-3 py-1.5 text-xs transition-colors"
                                style={{
                                    background: 'rgba(0,200,150,0.15)',
                                    border: '2px solid #00C896',
                                    color: '#00C896',
                                    fontWeight: 700,
                                }}
                            >
                                Clear selection
                            </button>
                        ) : null}
                    </div>

                    <p className="mb-4 text-xs text-di-text-secondary">
                        Click a medication to highlight its side effects. Click again to deselect. Drag nodes to rearrange.
                    </p>

                    {error ? (
                        <ErrorCard error={error} onRetry={loadGraph} />
                    ) : loading && !graphData ? (
                        <SkeletonChart height="h-[750px]" />
                    ) : (
                        <div
                            ref={containerRef}
                            className="h-[750px] w-full overflow-hidden rounded-xl"
                            style={{
                                background: 'radial-gradient(ellipse at center, #0d2018 0%, #071510 100%)',
                                border: '1px solid rgba(0,200,150,0.15)',
                            }}
                        >
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
