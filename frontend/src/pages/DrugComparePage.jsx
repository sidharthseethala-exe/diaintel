import React, { useEffect, useMemo, useState } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonChart } from '../components/Dashboard/SkeletonLoaders';
import { compareDrugs } from '../services/api';

const DRUG_OPTIONS = [
    'ozempic',
    'metformin',
    'wegovy',
    'semaglutide',
    'trulicity',
    'liraglutide',
    'dulaglutide',
    'glipizide',
];

const CHART_COLORS = ['#00C896', '#F59E0B'];

function ErrorCard({ title, error, onRetry }) {
    return (
        <div className="di-card">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="di-section-title mb-1">{title}</h2>
                    <p className="text-sm text-di-text-secondary">{error || 'Failed to load comparison data.'}</p>
                </div>
                <button type="button" className="di-btn-secondary" onClick={onRetry}>
                    Retry
                </button>
            </div>
        </div>
    );
}

function sentimentLabelFromScore(score) {
    if (score >= 0.4) {
        return 'Positive';
    }
    if (score > 0.05) {
        return 'Slightly Positive';
    }
    if (score <= -0.4) {
        return 'Negative';
    }
    if (score < -0.05) {
        return 'Slightly Negative';
    }
    return 'Neutral';
}

function DrugComparePage() {
    const [drug1, setDrug1] = useState('ozempic');
    const [drug2, setDrug2] = useState('metformin');
    const [comparison, setComparison] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadComparison = async (firstDrug = drug1, secondDrug = drug2) => {
        if (!firstDrug || !secondDrug || firstDrug === secondDrug) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await compareDrugs([firstDrug, secondDrug]);
            setComparison(response.data);
        } catch (requestError) {
            setError(requestError.response?.data?.detail || requestError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadComparison('ozempic', 'metformin');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const aeMatrixData = useMemo(() => {
        if (!comparison?.drugs?.length) {
            return [];
        }
        const [first, second] = comparison.drugs;
        return (comparison.ae_matrix || []).map((row) => ({
            ae_term: row.ae_term,
            [first.drug_name]: row.counts?.[first.drug_name] || 0,
            [second.drug_name]: row.counts?.[second.drug_name] || 0,
        }));
    }, [comparison]);

    const sentimentData = useMemo(
        () =>
            (comparison?.drugs || []).map((drug) => ({
                name: drug.display_name,
                overall_sentiment: drug.sentiment_score,
            })),
        [comparison]
    );

    const postVolumeData = useMemo(
        () =>
            (comparison?.drugs || []).map((drug) => ({
                name: drug.display_name,
                total_posts: drug.total_posts,
            })),
        [comparison]
    );

    const canCompare = drug1 && drug2 && drug1 !== drug2;
    const firstKey = comparison?.drugs?.[0]?.drug_name;
    const secondKey = comparison?.drugs?.[1]?.drug_name;

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <div>
                    <h1 className="text-2xl font-bold text-di-text">Medication Comparison</h1>
                    <p className="mt-1 text-sm text-di-text-secondary">
                        Compare side effects, patient sentiment, and discussion volume for two medications.
                    </p>
                </div>

                <div className="di-card">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                        <div className="flex-1">
                            <label className="mb-2 block text-sm text-di-text-secondary">First Medication</label>
                            <select className="di-input" value={drug1} onChange={(event) => setDrug1(event.target.value)}>
                                {DRUG_OPTIONS.map((drug) => (
                                    <option key={drug} value={drug} disabled={drug === drug2}>
                                        {drug}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="mb-2 block text-sm text-di-text-secondary">Second Medication</label>
                            <select className="di-input" value={drug2} onChange={(event) => setDrug2(event.target.value)}>
                                {DRUG_OPTIONS.map((drug) => (
                                    <option key={drug} value={drug} disabled={drug === drug1}>
                                        {drug}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <button type="button" className="di-btn-primary whitespace-nowrap" disabled={!canCompare || loading} onClick={() => loadComparison()}>
                            {loading ? 'Comparing...' : 'Compare'}
                        </button>
                    </div>
                </div>

                {error ? (
                    <ErrorCard title="Comparison" error={error} onRetry={() => loadComparison()} />
                ) : loading && !comparison ? (
                    <SkeletonChart height="h-96" />
                ) : comparison ? (
                    <div className="space-y-6">
                        <div className="di-card">
                            <h2 className="di-section-title">Shared Side Effects Comparison</h2>
                            {aeMatrixData.length ? (
                                <div className="h-96">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={aeMatrixData} margin={{ top: 8, right: 12, left: 8, bottom: 48 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1E3A2F" />
                                            <XAxis dataKey="ae_term" stroke="#8BA89E" tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={70} />
                                            <YAxis stroke="#8BA89E" tickLine={false} axisLine={false} />
                                            <Tooltip contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }} />
                                            <Legend />
                                            {firstKey ? <Bar dataKey={firstKey} fill={CHART_COLORS[0]} radius={[8, 8, 0, 0]} /> : null}
                                            {secondKey ? <Bar dataKey={secondKey} fill={CHART_COLORS[1]} radius={[8, 8, 0, 0]} /> : null}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                    No overlapping side effects were found for this pair.
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                            <div className="di-card">
                                <h2 className="di-section-title">Patient Sentiment Comparison</h2>
                                {sentimentData.length ? (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={sentimentData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A2F" />
                                                <XAxis dataKey="name" stroke="#8BA89E" tickLine={false} axisLine={false} />
                                                <YAxis stroke="#8BA89E" tickLine={false} axisLine={false} tickFormatter={sentimentLabelFromScore} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }}
                                                    formatter={(value) => [sentimentLabelFromScore(value), 'Patient sentiment']}
                                                />
                                                <Bar dataKey="overall_sentiment" fill="#00C896" radius={[8, 8, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                        No patient sentiment comparison data available.
                                    </div>
                                )}
                            </div>

                            <div className="di-card">
                                <h2 className="di-section-title">Discussion Volume</h2>
                                {postVolumeData.length ? (
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={postVolumeData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A2F" />
                                                <XAxis dataKey="name" stroke="#8BA89E" tickLine={false} axisLine={false} />
                                                <YAxis stroke="#8BA89E" tickLine={false} axisLine={false} />
                                                <Tooltip contentStyle={{ backgroundColor: '#112820', border: '1px solid #1E3A2F', borderRadius: '12px', color: '#FFFFFF' }} />
                                                <Bar dataKey="total_posts" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-di-border text-sm text-di-text-secondary">
                                        No discussion volume data available.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </ErrorBoundary>
    );
}

export default DrugComparePage;
