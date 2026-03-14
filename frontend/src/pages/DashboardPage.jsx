import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonChart, SkeletonList, SkeletonStat } from '../components/Dashboard/SkeletonLoaders';
import { useApi, useWebSocket } from '../hooks/useApi';
import { getDashboardStats, getIngestionStatus, getTrending } from '../services/api';

const CHART_COLORS = {
    accent: '#00C896',
    warning: '#F59E0B',
    high: '#EF4444',
    low: '#10B981',
    muted: '#8BA89E',
    grid: '#1E3A2F',
};

function formatRelativeTime(value) {
    if (!value) {
        return 'No recent updates';
    }

    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
        return 'Just now';
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function formatDateTime(value) {
    if (!value) {
        return '-';
    }

    return new Intl.DateTimeFormat('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(value));
}

function formatCompactNumber(value) {
    return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(
        value || 0
    );
}

function severityColor(severity) {
    if (severity === 'severe') {
        return CHART_COLORS.high;
    }
    if (severity === 'mild') {
        return CHART_COLORS.low;
    }
    return CHART_COLORS.warning;
}

function statusBadge(status) {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'completed') {
        return 'di-badge-green';
    }
    if (normalized === 'failed') {
        return 'di-badge-red';
    }
    return 'di-badge-yellow';
}

function ErrorCard({ title, error, onRetry }) {
    return (
        <div className="di-card border-di-severity-high/40">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-base font-semibold text-di-text">{title}</h3>
                    <p className="mt-2 text-sm text-di-text-secondary">{error || 'Something went wrong.'}</p>
                </div>
                <button type="button" className="di-btn-secondary" onClick={onRetry}>
                    Retry
                </button>
            </div>
        </div>
    );
}

function DashboardPage() {
    const dashboard = useApi(getDashboardStats, []);
    const trending = useApi(getTrending, []);
    const ingestion = useApi(getIngestionStatus, []);
    const {
        data: dashboardData,
        loading: dashboardLoading,
        error: dashboardError,
        refetch: refetchDashboard,
    } = dashboard;
    const {
        data: trendingData,
        loading: trendingLoading,
        error: trendingError,
        refetch: refetchTrending,
    } = trending;
    const {
        data: ingestionData,
        loading: ingestionLoading,
        error: ingestionError,
        refetch: refetchIngestion,
    } = ingestion;
    const { isConnected, lastUpdate } = useWebSocket();
    const [pulseStats, setPulseStats] = useState(false);

    useEffect(() => {
        if (!lastUpdate) {
            return undefined;
        }

        setPulseStats(true);

        const refetchTimer = window.setTimeout(() => {
            refetchDashboard();
            if (lastUpdate.progress !== undefined) {
                refetchIngestion();
            }
            if (lastUpdate.count !== undefined || lastUpdate.progress !== undefined) {
                refetchTrending();
            }
        }, 300);

        const pulseTimer = window.setTimeout(() => setPulseStats(false), 1400);

        return () => {
            window.clearTimeout(refetchTimer);
            window.clearTimeout(pulseTimer);
        };
    }, [lastUpdate, refetchDashboard, refetchIngestion, refetchTrending]);

    const statCards = useMemo(() => {
        return [
            {
                label: 'Total Posts Processed',
                value: formatCompactNumber(dashboardData?.total_posts),
                helper: `${formatCompactNumber(ingestionData?.total_records_loaded)} rows loaded`,
            },
            {
                label: 'AE Signals Detected',
                value: formatCompactNumber(dashboardData?.total_ae_signals),
                helper:
                    lastUpdate?.count !== undefined
                        ? `${lastUpdate.count} new signal(s)`
                        : 'Across all tracked drugs',
            },
            {
                label: 'Drugs Tracked',
                value: formatCompactNumber(dashboardData?.total_drugs_tracked),
                helper: 'Normalized across brand and generic mentions',
            },
            {
                label: 'Last Updated',
                value: formatRelativeTime(lastUpdate?.last_updated || dashboardData?.last_updated),
                helper: formatDateTime(lastUpdate?.last_updated || dashboardData?.last_updated),
            },
        ];
    }, [dashboardData, ingestionData, lastUpdate]);

    const trendingChartData = useMemo(
        () =>
            (trendingData?.trending || []).map((item) => ({
                ae_term: item.ae_term,
                current_count: item.current_count,
                change_percent: item.change_percent,
            })),
        [trendingData]
    );

    const sentimentChartData = useMemo(
        () =>
            Object.entries(dashboardData?.sentiment_overview || {}).map(([drug, score]) => ({
                drug,
                positive: score > 0 ? Number(score.toFixed(3)) : 0,
                negative: score < 0 ? Number(Math.abs(score).toFixed(3)) : 0,
            })),
        [dashboardData]
    );

    const hasDashboardError = dashboardError && !dashboardLoading;
    const hasTrendingError = trendingError && !trendingLoading;
    const hasIngestionError = ingestionError && !ingestionLoading;

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-sm uppercase tracking-[0.25em] text-di-text-secondary">Step 10</p>
                        <h1 className="mt-2 text-3xl font-bold text-di-text">Platform Dashboard</h1>
                        <p className="mt-2 max-w-3xl text-sm text-di-text-secondary">
                            High-level view of ingestion, signal detection, and sentiment shifts across DiaIntel.
                        </p>
                    </div>
                    <div className="di-card min-w-[280px] p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium text-di-text">Live pipeline status</div>
                                <div className="mt-1 text-xs text-di-text-secondary">
                                    {lastUpdate?.message || 'Waiting for the next ingestion or NLP event'}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div
                                    className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-di-accent animate-pulse-slow' : 'bg-di-warning'}`}
                                />
                                <span className="text-xs font-medium text-di-text-secondary">
                                    {isConnected ? 'WebSocket live' : 'Reconnecting'}
                                </span>
                            </div>
                        </div>
                        {lastUpdate?.progress !== undefined ? (
                            <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between text-xs text-di-text-secondary">
                                    <span>Processing progress</span>
                                    <span>{Math.round(lastUpdate.progress)}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-di-bg">
                                    <div
                                        className="h-full rounded-full bg-di-accent transition-all duration-500"
                                        style={{ width: `${Math.max(0, Math.min(100, lastUpdate.progress))}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {dashboardLoading && !dashboardData
                        ? Array.from({ length: 4 }).map((_, index) => <SkeletonStat key={index} />)
                        : statCards.map((stat) => (
                            <div
                                key={stat.label}
                                className={`di-card transition-all duration-300 ${pulseStats ? 'glow-accent border-di-accent/40' : ''}`}
                            >
                                <div className="text-3xl font-bold text-di-accent">{stat.value}</div>
                                <div className="mt-2 text-sm font-medium text-di-text">{stat.label}</div>
                                <div className="mt-1 text-xs text-di-text-secondary">{stat.helper}</div>
                            </div>
                        ))}
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                    {hasTrendingError ? (
                        <ErrorCard title="Trending adverse events" error={trendingError} onRetry={refetchTrending} />
                    ) : trendingLoading && !trendingData ? (
                        <SkeletonChart height="h-80" />
                    ) : (
                        <div className="di-card">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="di-section-title mb-1">Trending AEs This Month</h2>
                                    <p className="text-sm text-di-text-secondary">
                                        Highest growth in the last {trendingData?.period_days || 30} days.
                                    </p>
                                </div>
                                <span className="di-badge-yellow">{trendingChartData.length} signals</span>
                            </div>
                            {trendingChartData.length ? (
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={trendingChartData}
                                            layout="vertical"
                                            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                                            <XAxis
                                                type="number"
                                                stroke={CHART_COLORS.muted}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <YAxis
                                                dataKey="ae_term"
                                                type="category"
                                                width={110}
                                                stroke={CHART_COLORS.muted}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <Tooltip
                                                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                                contentStyle={{
                                                    backgroundColor: '#112820',
                                                    border: '1px solid #1E3A2F',
                                                    borderRadius: '12px',
                                                    color: '#FFFFFF',
                                                }}
                                                formatter={(value) => [`${value} mentions`, 'Current window']}
                                            />
                                            <Bar dataKey="current_count" radius={[0, 8, 8, 0]}>
                                                {trendingChartData.map((entry) => (
                                                    <Cell
                                                        key={entry.ae_term}
                                                        fill={entry.change_percent >= 100 ? CHART_COLORS.high : CHART_COLORS.warning}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                    No trending adverse-event data yet.
                                </div>
                            )}
                        </div>
                    )}

                    {hasDashboardError ? (
                        <ErrorCard title="Recent signals" error={dashboardError} onRetry={refetchDashboard} />
                    ) : dashboardLoading && !dashboardData ? (
                        <SkeletonList items={5} />
                    ) : (
                        <div className="di-card">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="di-section-title mb-1">Recent Signals Feed</h2>
                                    <p className="text-sm text-di-text-secondary">
                                        Latest extracted adverse events with source confidence.
                                    </p>
                                </div>
                                <span className="di-badge-green">Live</span>
                            </div>
                            <div className="space-y-3">
                                {(dashboardData?.recent_signals || []).length ? (
                                    dashboardData.recent_signals.map((signal) => (
                                        <Link
                                            key={signal.id}
                                            to={`/drug/${encodeURIComponent(signal.drug_name)}`}
                                            className="block rounded-xl border border-di-border bg-di-bg/60 p-4 transition-colors hover:border-di-accent/40"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="di-badge-green">{signal.drug_name}</span>
                                                        <span
                                                            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                                                            style={{
                                                                backgroundColor: `${severityColor(signal.severity)}22`,
                                                                color: severityColor(signal.severity),
                                                            }}
                                                        >
                                                            {signal.severity}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 text-base font-semibold text-di-text">
                                                        {signal.ae_term}
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-di-text-secondary">
                                                        <span>Signal #{signal.id}</span>
                                                        <span>{formatRelativeTime(signal.detected_at)}</span>
                                                        <span>{formatDateTime(signal.detected_at)}</span>
                                                    </div>
                                                </div>
                                                <div className="di-confidence">{Math.round(signal.confidence * 100)}%</div>
                                            </div>
                                        </Link>
                                    ))
                                ) : (
                                    <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                        No recent signals yet. Run the pipeline or seed data to populate this feed.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
                    {hasDashboardError ? (
                        <ErrorCard title="Sentiment overview" error={dashboardError} onRetry={refetchDashboard} />
                    ) : dashboardLoading && !dashboardData ? (
                        <SkeletonChart height="h-80" />
                    ) : (
                        <div className="di-card">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="di-section-title mb-1">Sentiment Overview</h2>
                                    <p className="text-sm text-di-text-secondary">
                                        Average per-drug sentiment split into positive and negative intensity.
                                    </p>
                                </div>
                                <span className="text-xs text-di-text-secondary">
                                    {dashboardData?.processing_time_ms || 0} ms API time
                                </span>
                            </div>
                            {sentimentChartData.length ? (
                                <div className="h-80">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={sentimentChartData} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                                            <XAxis dataKey="drug" stroke={CHART_COLORS.muted} tickLine={false} axisLine={false} />
                                            <YAxis stroke={CHART_COLORS.muted} tickLine={false} axisLine={false} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#112820',
                                                    border: '1px solid #1E3A2F',
                                                    borderRadius: '12px',
                                                    color: '#FFFFFF',
                                                }}
                                            />
                                            <Bar dataKey="positive" fill={CHART_COLORS.low} radius={[8, 8, 0, 0]} />
                                            <Bar dataKey="negative" fill={CHART_COLORS.high} radius={[8, 8, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                    No sentiment data available yet.
                                </div>
                            )}
                        </div>
                    )}

                    {hasIngestionError ? (
                        <ErrorCard title="Ingestion status" error={ingestionError} onRetry={refetchIngestion} />
                    ) : ingestionLoading && !ingestionData ? (
                        <SkeletonChart height="h-80" />
                    ) : (
                        <div className="di-card">
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 className="di-section-title mb-1">Data Ingestion Status</h2>
                                    <p className="text-sm text-di-text-secondary">
                                        Per-file loader progress from Pushshift ingestion logs.
                                    </p>
                                </div>
                                <span className="text-xs text-di-text-secondary">
                                    Total loaded: {formatCompactNumber(ingestionData?.total_records_loaded)}
                                </span>
                            </div>
                            {(ingestionData?.files || []).length ? (
                                <div className="overflow-hidden rounded-xl border border-di-border">
                                    <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr] gap-3 bg-di-bg/70 px-4 py-3 text-xs uppercase tracking-wide text-di-text-secondary">
                                        <span>File</span>
                                        <span>Read</span>
                                        <span>Inserted</span>
                                        <span>Status</span>
                                    </div>
                                    <div className="divide-y divide-di-border">
                                        {ingestionData.files.map((file) => (
                                            <div
                                                key={`${file.filename}-${file.started_at || file.completed_at || file.status}`}
                                                className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-sm"
                                            >
                                                <div>
                                                    <div className="font-medium text-di-text">{file.filename}</div>
                                                    <div className="mt-1 text-xs text-di-text-secondary">
                                                        {formatDateTime(file.completed_at || file.started_at)}
                                                    </div>
                                                </div>
                                                <div className="text-di-text-secondary">{formatCompactNumber(file.records_read)}</div>
                                                <div className="text-di-text-secondary">{formatCompactNumber(file.records_inserted)}</div>
                                                <div>
                                                    <span className={statusBadge(file.status)}>{file.status}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                    No ingestion logs found yet.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default DashboardPage;
