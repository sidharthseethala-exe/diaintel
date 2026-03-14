import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonCard, SkeletonChart, SkeletonList } from '../components/Dashboard/SkeletonLoaders';
import {
    getDrugCombinations,
    getDrugInsights,
    getDrugOutcomes,
    getDrugTimeline,
} from '../services/api';

const COLORS = {
    mild: '#10B981',
    moderate: '#F59E0B',
    severe: '#EF4444',
    accent: '#00C896',
    grid: '#1E3A2F',
    text: '#8BA89E',
};

const POPULAR_DRUGS = ['metformin', 'ozempic', 'jardiance', 'januvia', 'farxiga', 'trulicity', 'victoza', 'glipizide'];

function SectionError({ title, error, onRetry }) {
    return (
        <div className="di-card">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="di-section-title mb-1">{title}</h2>
                    <p className="text-sm text-di-text-secondary">{error || 'Failed to load this section.'}</p>
                </div>
                <button type="button" className="di-btn-secondary" onClick={onRetry}>
                    Retry
                </button>
            </div>
        </div>
    );
}

function formatMonth(month) {
    if (!month) {
        return '';
    }
    const [year, monthNumber] = month.split('-');
    return new Date(Number(year), Number(monthNumber) - 1, 1).toLocaleDateString('en-IN', {
        month: 'short',
    });
}

function formatDate(value) {
    if (!value) {
        return '-';
    }
    return new Intl.DateTimeFormat('en-IN', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(value));
}

function dominantSeverity(breakdown = {}) {
    const entries = Object.entries(breakdown);
    if (!entries.length) {
        return 'moderate';
    }
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0] || 'moderate';
}

function sentimentLabelFromScore(score) {
    if (score > 0.05) {
        return 'Positive';
    }
    if (score < -0.05) {
        return 'Slightly Negative';
    }
    return 'Neutral';
}

function DrugProfilePage() {
    const { drugName } = useParams();
    const navigate = useNavigate();
    const [searchValue, setSearchValue] = useState(drugName || '');

    const [insights, setInsights] = useState(null);
    const [timeline, setTimeline] = useState(null);
    const [outcomes, setOutcomes] = useState(null);
    const [combinations, setCombinations] = useState(null);

    const [loading, setLoading] = useState({ insights: false, timeline: false, outcomes: false, combinations: false });
    const [errors, setErrors] = useState({ insights: null, timeline: null, outcomes: null, combinations: null });

    useEffect(() => {
        setSearchValue(drugName || '');
    }, [drugName]);

    useEffect(() => {
        if (!drugName) {
            return;
        }

        const loadInsights = async () => {
            setLoading((prev) => ({ ...prev, insights: true }));
            setErrors((prev) => ({ ...prev, insights: null }));
            try {
                const response = await getDrugInsights(drugName);
                setInsights(response.data);
            } catch (error) {
                setErrors((prev) => ({ ...prev, insights: error.response?.data?.detail || error.message }));
            } finally {
                setLoading((prev) => ({ ...prev, insights: false }));
            }
        };

        const loadTimeline = async () => {
            setLoading((prev) => ({ ...prev, timeline: true }));
            setErrors((prev) => ({ ...prev, timeline: null }));
            try {
                const response = await getDrugTimeline(drugName);
                setTimeline(response.data);
            } catch (error) {
                setErrors((prev) => ({ ...prev, timeline: error.response?.data?.detail || error.message }));
            } finally {
                setLoading((prev) => ({ ...prev, timeline: false }));
            }
        };

        const loadOutcomes = async () => {
            setLoading((prev) => ({ ...prev, outcomes: true }));
            setErrors((prev) => ({ ...prev, outcomes: null }));
            try {
                const response = await getDrugOutcomes(drugName);
                setOutcomes(response.data);
            } catch (error) {
                setErrors((prev) => ({ ...prev, outcomes: error.response?.data?.detail || error.message }));
            } finally {
                setLoading((prev) => ({ ...prev, outcomes: false }));
            }
        };

        const loadCombinations = async () => {
            setLoading((prev) => ({ ...prev, combinations: true }));
            setErrors((prev) => ({ ...prev, combinations: null }));
            try {
                const response = await getDrugCombinations(drugName);
                setCombinations(response.data);
            } catch (error) {
                setErrors((prev) => ({ ...prev, combinations: error.response?.data?.detail || error.message }));
            } finally {
                setLoading((prev) => ({ ...prev, combinations: false }));
            }
        };

        loadInsights();
        loadTimeline();
        loadOutcomes();
        loadCombinations();
    }, [drugName]);

    const aeChartData = useMemo(
        () =>
            (insights?.top_adverse_events || []).map((item) => ({
                ae_term: item.ae_term,
                count: item.count,
                severity: dominantSeverity(item.severity_breakdown),
            })),
        [insights]
    );

    const timelineChartData = useMemo(
        () =>
            (timeline?.timeline || []).map((item) => ({
                month: formatMonth(item.month),
                sentiment: item.positive_count - item.negative_count,
                ae_count: item.ae_count,
            })),
        [timeline]
    );

    const severityData = useMemo(
        () =>
            Object.entries(insights?.severity_breakdown || {})
                .map(([name, value]) => ({ name, value }))
                .filter((item) => item.value > 0),
        [insights]
    );

    const outcomeRows = outcomes?.top_categories || [];
    const combinationRows = combinations?.combinations || [];

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        const normalized = searchValue.trim().toLowerCase();
        if (!normalized) {
            return;
        }
        navigate(`/drug/${normalized}`);
    };

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <form className="di-card" onSubmit={handleSearchSubmit}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <input
                            type="text"
                            placeholder="Search for a medication (e.g. Ozempic, Metformin, Jardiance...)"
                            className="di-input"
                            value={searchValue}
                            onChange={(event) => setSearchValue(event.target.value)}
                        />
                        <button type="submit" className="di-btn-primary whitespace-nowrap">
                            Search
                        </button>
                    </div>
                </form>

                {!drugName ? (
                    <div className="di-card py-16 text-center">
                        <h1 className="text-2xl font-bold text-di-text">Medication Safety Profile</h1>
                        <p className="mx-auto mt-3 max-w-2xl text-sm text-di-text-secondary">
                            Select a medication below to explore its patient-reported safety profile:
                        </p>
                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                            {POPULAR_DRUGS.map((drug) => (
                                <button
                                    key={drug}
                                    type="button"
                                    className="di-btn-secondary text-sm capitalize"
                                    onClick={() => navigate(`/drug/${drug}`)}
                                >
                                    {drug}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {loading.insights && !insights ? (
                            <SkeletonCard lines={4} />
                        ) : errors.insights ? (
                            <SectionError title="Medication profile" error={errors.insights} onRetry={() => navigate(0)} />
                        ) : insights ? (
                            <div className="di-card">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h1 className="text-3xl font-bold text-di-text">{insights.display_name}</h1>
                                            <span className="di-badge-green capitalize">{sentimentLabelFromScore(insights.overall_sentiment)}</span>
                                        </div>
                                        <p className="mt-2 text-sm text-di-text-secondary">
                                            Patient-reported safety profile based on real discussion data
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {(insights.brand_names || []).map((brand) => (
                                                <span key={brand} className="di-badge-yellow">{brand}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <Link to="/compare" className="di-btn-secondary whitespace-nowrap">
                                        Compare Medications
                                    </Link>
                                </div>
                                <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                                    <div className="rounded-xl bg-di-bg/60 p-4">
                                        <div className="text-2xl font-bold text-di-accent">{insights.total_posts}</div>
                                        <div className="mt-1 text-xs text-di-text-secondary">Patient Discussions</div>
                                    </div>
                                    <div className="rounded-xl bg-di-bg/60 p-4">
                                        <div className="text-2xl font-bold text-di-text capitalize">{insights.sentiment_label}</div>
                                        <div className="mt-1 text-xs text-di-text-secondary">Reported outlook</div>
                                    </div>
                                    <div className="rounded-xl bg-di-bg/60 p-4">
                                        <div className="text-2xl font-bold text-di-text">{sentimentLabelFromScore(insights.overall_sentiment)}</div>
                                        <div className="mt-1 text-xs text-di-text-secondary">Overall patient sentiment</div>
                                    </div>
                                    <div className="rounded-xl bg-di-bg/60 p-4">
                                        <div className="text-2xl font-bold text-di-text">{formatDate(insights.last_signal_time)}</div>
                                        <div className="mt-1 text-xs text-di-text-secondary">Last Report</div>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            {loading.insights && !insights ? (
                                <SkeletonChart height="h-80" />
                            ) : errors.insights ? (
                                <SectionError title="Most Reported Side Effects" error={errors.insights} onRetry={() => navigate(0)} />
                            ) : (
                                <div className="di-card">
                                    <h2 className="di-section-title">Most Reported Side Effects</h2>
                                    {aeChartData.length ? (
                                        <div className="h-80">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={aeChartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                                                    <XAxis type="number" stroke={COLORS.text} tickLine={false} axisLine={false} />
                                                    <YAxis dataKey="ae_term" type="category" width={120} stroke={COLORS.text} tickLine={false} axisLine={false} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }} />
                                                    <Bar dataKey="count" radius={[0, 8, 8, 0]}>
                                                        {aeChartData.map((entry) => (
                                                            <Cell key={entry.ae_term} fill={COLORS[entry.severity] || COLORS.moderate} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                            No side effect reports are available for this medication yet.
                                        </div>
                                    )}
                                </div>
                            )}

                            {loading.timeline && !timeline ? (
                                <SkeletonChart height="h-80" />
                            ) : errors.timeline ? (
                                <SectionError title="Patient Sentiment Over Time" error={errors.timeline} onRetry={() => navigate(0)} />
                            ) : (
                                <div className="di-card">
                                    <h2 className="di-section-title">Patient Sentiment Over Time</h2>
                                    {timelineChartData.length ? (
                                        <div className="h-80">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={timelineChartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                                                    <XAxis dataKey="month" stroke={COLORS.text} tickLine={false} axisLine={false} />
                                                    <YAxis stroke={COLORS.text} tickLine={false} axisLine={false} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }} />
                                                    <Line type="monotone" dataKey="sentiment" stroke={COLORS.accent} strokeWidth={3} dot={{ r: 3 }} />
                                                    <Line type="monotone" dataKey="ae_count" stroke={COLORS.severe} strokeWidth={2} dot={{ r: 2 }} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                            No patient sentiment history is available yet.
                                        </div>
                                    )}
                                </div>
                            )}

                            {loading.insights && !insights ? (
                                <SkeletonChart height="h-72" />
                            ) : errors.insights ? (
                                <SectionError title="Side Effect Severity Distribution" error={errors.insights} onRetry={() => navigate(0)} />
                            ) : (
                                <div className="di-card">
                                    <h2 className="di-section-title">Side Effect Severity Distribution</h2>
                                    {severityData.length ? (
                                        <div className="h-72">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={severityData}
                                                        dataKey="value"
                                                        nameKey="name"
                                                        innerRadius={60}
                                                        outerRadius={95}
                                                        paddingAngle={4}
                                                    >
                                                        {severityData.map((entry) => (
                                                            <Cell key={entry.name} fill={COLORS[entry.name] || COLORS.moderate} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                            No side effect severity information is available yet.
                                        </div>
                                    )}
                                    <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                                        {['mild', 'moderate', 'severe'].map((level) => (
                                            <div key={level} className="rounded-xl bg-di-bg/60 p-3">
                                                <div className="font-semibold capitalize" style={{ color: COLORS[level] }}>{level}</div>
                                                <div className="mt-1 text-di-text-secondary">{insights?.severity_breakdown?.[level] || 0}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {loading.outcomes && !outcomes ? (
                                <SkeletonList items={4} />
                            ) : errors.outcomes ? (
                                <SectionError title="Reported Treatment Outcomes" error={errors.outcomes} onRetry={() => navigate(0)} />
                            ) : (
                                <div className="di-card">
                                    <h2 className="di-section-title">Reported Treatment Outcomes</h2>
                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                        {['positive', 'negative', 'neutral', 'total'].map((key) => (
                                            <div key={key} className="rounded-xl bg-di-bg/60 p-3 text-center">
                                                <div className="text-lg font-bold text-di-accent">{outcomes?.summary?.[key] || 0}</div>
                                                <div className="mt-1 text-xs capitalize text-di-text-secondary">{key}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {outcomeRows.length ? outcomeRows.slice(0, 5).map((row) => (
                                            <div key={`${row.outcome_category}-${row.polarity}`} className="flex items-center justify-between rounded-xl bg-di-bg/60 p-3 text-sm">
                                                <div>
                                                    <div className="font-medium text-di-text">{row.outcome_category.replace(/_/g, ' ')}</div>
                                                    <div className="mt-1 text-xs capitalize text-di-text-secondary">{row.polarity}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-semibold text-di-accent">{row.count}</div>
                                                    <div className="mt-1 text-xs text-di-text-secondary">{Math.round(row.avg_confidence * 100)}% confidence</div>
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="rounded-xl border border-dashed border-di-border p-6 text-center text-sm text-di-text-secondary">
                                                No treatment outcomes are available yet.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {loading.combinations && !combinations ? (
                            <SkeletonChart height="h-64" />
                        ) : errors.combinations ? (
                            <SectionError title="Commonly Co-prescribed Medications" error={errors.combinations} onRetry={() => navigate(0)} />
                        ) : (
                            <div className="di-card">
                                <h2 className="di-section-title">Commonly Co-prescribed Medications</h2>
                                {combinationRows.length ? (
                                    <div className="overflow-hidden rounded-xl border border-di-border">
                                        <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr] gap-4 bg-di-bg/70 px-4 py-3 text-xs uppercase tracking-wide text-di-text-secondary">
                                            <span>Medication Pair</span>
                                            <span>Patient Reports</span>
                                            <span>Co-prescription Rate</span>
                                        </div>
                                        <div className="divide-y divide-di-border">
                                            {combinationRows.map((row) => (
                                                <div key={`${row.drug_1}-${row.drug_2}`} className="grid grid-cols-[1.4fr_0.7fr_0.8fr] gap-4 px-4 py-3 text-sm">
                                                    <span className="text-di-text">{row.drug_1} / {row.drug_2}</span>
                                                    <span className="text-di-text-secondary">{row.post_count}</span>
                                                    <span className="text-di-accent">{Math.round(row.concurrency_score * 100)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-dashed border-di-border p-8 text-center text-sm text-di-text-secondary">
                                        No commonly co-prescribed medications were found for this profile yet.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </ErrorBoundary>
    );
}

export default DrugProfilePage;
