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

        const containerWidth = containerRef.current.clientWidth || 960;
        const width = containerWidth;
        const height = 600;
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();
        svg.attr('viewBox', `0 0 ${width} ${height}`);

        const root = svg.append('g');
        svg.call(
            d3.zoom().scaleExtent([0.5, 2.5]).on('zoom', (event) => {
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

        const simulation = d3
            .forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d) => d.id).distance((d) => (d.type === 'drug_combination' ? 90 : 130)))
            .force('charge', d3.forceManyBody().strength(-260))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius((d) => (d.type === 'drug' ? 26 : d.type === 'outcome' ? 20 : 14)));

        const link = root
            .append('g')
            .attr('stroke', '#3A5A4D')
            .attr('stroke-opacity', 0.7)
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke-width', (d) => Math.max(1.2, Math.sqrt(d.weight || 1)));

        const node = root
            .append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
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

        node
            .append('circle')
            .attr('r', (d) => (d.type === 'drug' ? 16 : d.type === 'outcome' ? 12 : 9))
            .attr('fill', (d) => NODE_COLORS[d.type] || NODE_COLORS.ae)
            .attr('stroke', '#DDECE6')
            .attr('stroke-width', 1.2);

        node
            .append('text')
            .text((d) => d.label)
            .attr('fill', '#FFFFFF')
            .attr('font-size', 11)
            .attr('dx', 14)
            .attr('dy', 4);

        const resetHighlight = () => {
            node.transition().duration(180).style('opacity', 1);
            link.transition().duration(180).style('opacity', 0.7);
        };

        node.on('click', (_, clickedNode) => {
            const connectedNodes = neighborMap.get(clickedNode.id) || new Set();
            connectedNodes.add(clickedNode.id);

            node
                .transition()
                .duration(180)
                .style('opacity', (d) => (connectedNodes.has(d.id) ? 1 : 0.15));

            link
                .transition()
                .duration(180)
                .style('opacity', (d) =>
                    d.source.id === clickedNode.id || d.target.id === clickedNode.id ? 1 : 0.08
                );
        });

        svg.on('dblclick', () => {
            resetHighlight();
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
    }, [graphData]);

    const stats = useMemo(() => {
        const fallback = { drug_nodes: 0, ae_nodes: 0, total_edges: 0 };
        return graphData?.stats || fallback;
    }, [graphData]);

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
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.drug }} /><span>Medication</span></div>
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: NODE_COLORS.ae }} /><span>Side Effect</span></div>
                    </div>
                </div>

                {error ? (
                    <ErrorCard error={error} onRetry={loadGraph} />
                ) : loading && !graphData ? (
                    <SkeletonChart height="h-[600px]" />
                ) : (
                    <div className="di-card">
                        <div ref={containerRef} className="h-[600px] w-full overflow-hidden rounded-xl bg-di-bg/50">
                            <svg ref={svgRef} className="h-full w-full" />
                        </div>
                    </div>
                )}

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

