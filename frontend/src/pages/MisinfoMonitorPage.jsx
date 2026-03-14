import React, { useEffect, useState } from 'react';

import ErrorBoundary from '../ErrorBoundary';
import { SkeletonList } from '../components/Dashboard/SkeletonLoaders';
import { getMisinfoFeed, markAsReviewed } from '../services/api';

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

function formatFlagReason(reason) {
    const normalized = (reason || '').toLowerCase();
    if (normalized.includes('false medical claim')) {
        return 'False Medical Claim';
    }
    if (normalized.includes('contradicts established medical guidelines') || normalized.includes('contradicts medical guidelines')) {
        return 'Contradicts Guidelines';
    }
    if (normalized.includes('stopping prescribed medication') || normalized.includes('stopping medication')) {
        return 'Advises Stopping Medication';
    }
    return reason
        ?.replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Medical Claim Review';
}

function MisinfoMonitorPage() {
    const [minConfidence, setMinConfidence] = useState(0.5);
    const [showReviewed, setShowReviewed] = useState(false);
    const [page, setPage] = useState(1);
    const [feed, setFeed] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [reviewingId, setReviewingId] = useState(null);

    const loadFeed = async (options = {}) => {
        const nextPage = options.page ?? page;
        const nextReviewed = options.reviewed ?? showReviewed;
        const nextConfidence = options.minConfidence ?? minConfidence;

        setLoading(true);
        setError(null);
        try {
            const response = await getMisinfoFeed({
                page: nextPage,
                page_size: 20,
                reviewed: nextReviewed,
                min_confidence: nextConfidence,
            });
            setFeed(response.data);
        } catch (requestError) {
            setError(requestError.response?.data?.detail || requestError.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFeed({ page, reviewed: showReviewed, minConfidence });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, showReviewed, minConfidence]);

    const handleMarkReviewed = async (flagId) => {
        setReviewingId(flagId);
        try {
            await markAsReviewed(flagId);
            loadFeed();
        } catch (requestError) {
            setError(requestError.response?.data?.detail || requestError.message);
        } finally {
            setReviewingId(null);
        }
    };

    const totalPages = Math.max(1, Math.ceil((feed?.total || 0) / (feed?.page_size || 20)));

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-di-text">Medical Misinformation Monitor</h1>
                        <p className="mt-1 text-sm text-di-text-secondary">
                            Patient posts flagged by AI as potentially containing false or dangerous medical claims. Pending expert medical review.
                        </p>
                    </div>
                    <div className="di-badge-red text-sm">
                        Posts Flagged: {feed?.total || 0}
                    </div>
                </div>

                <div className="di-card">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex-1">
                            <label className="mb-2 block text-sm text-di-text-secondary">
                                Minimum AI Confidence: <span className="font-mono text-di-accent">{minConfidence.toFixed(2)}</span>
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="1.0"
                                step="0.05"
                                value={minConfidence}
                                onChange={(event) => {
                                    setPage(1);
                                    setMinConfidence(parseFloat(event.target.value));
                                }}
                                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-di-border accent-di-accent"
                            />
                            <div className="mt-1 flex justify-between text-xs text-di-text-secondary">
                                <span>0.50</span>
                                <span>1.00</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setPage(1);
                                    setShowReviewed(false);
                                }}
                                className={`di-btn text-sm ${!showReviewed ? 'border border-di-accent bg-di-accent/10 text-di-accent' : 'border border-di-border text-di-text-secondary'}`}
                            >
                                Unreviewed
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setPage(1);
                                    setShowReviewed(true);
                                }}
                                className={`di-btn text-sm ${showReviewed ? 'border border-di-accent bg-di-accent/10 text-di-accent' : 'border border-di-border text-di-text-secondary'}`}
                            >
                                Reviewed
                            </button>
                        </div>
                    </div>
                </div>

                {error ? (
                    <div className="di-card">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="di-section-title mb-1">Feed Error</h2>
                                <p className="text-sm text-di-text-secondary">{error}</p>
                            </div>
                            <button type="button" className="di-btn-secondary" onClick={() => loadFeed()}>
                                Retry
                            </button>
                        </div>
                    </div>
                ) : loading && !feed ? (
                    <SkeletonList items={6} />
                ) : (
                    <div className="space-y-4">
                        {(feed?.flags || []).length ? (
                            feed.flags.map((flag) => (
                                <div key={flag.id} className="di-card">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="di-badge-red capitalize">{formatFlagReason(flag.flag_reason)}</span>
                                                <span className="di-badge-yellow">{Math.round(flag.confidence * 100)}%</span>
                                                <span className={flag.reviewed ? 'di-badge-green' : 'di-badge-yellow'}>
                                                    {flag.reviewed ? 'Reviewed' : 'Unreviewed'}
                                                </span>
                                            </div>
                                            <p className="mt-4 text-base text-di-text">
                                                {flag.claim_text.slice(0, 150)}{flag.claim_text.length > 150 ? '...' : ''}
                                            </p>
                                            <p className="mt-3 text-sm text-di-text-secondary">
                                                {flag.excerpt}
                                            </p>
                                            <div className="mt-4 text-xs text-di-text-secondary">
                                                Reported on {formatDate(flag.flagged_at)}
                                            </div>
                                        </div>
                                        {!flag.reviewed ? (
                                            <button
                                                type="button"
                                                className="di-btn-primary whitespace-nowrap"
                                                disabled={reviewingId === flag.id}
                                                onClick={() => handleMarkReviewed(flag.id)}
                                            >
                                                {reviewingId === flag.id ? 'Saving...' : 'Mark as Reviewed'}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="di-card py-16 text-center">
                                <h2 className="text-xl font-semibold text-di-text">No flagged posts</h2>
                                <p className="mx-auto mt-3 max-w-xl text-sm text-di-text-secondary">
                                    No posts match the current confidence threshold. Try lowering the minimum confidence slider to see more flagged content.
                                </p>
                            </div>
                        )}

                        <div className="di-card">
                            <div className="flex items-center justify-between">
                                <button
                                    type="button"
                                    className="di-btn-secondary"
                                    disabled={page <= 1 || loading}
                                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                                >
                                    Previous
                                </button>
                                <span className="text-sm text-di-text-secondary">
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    type="button"
                                    className="di-btn-secondary"
                                    disabled={page >= totalPages || loading}
                                    onClick={() => setPage((current) => current + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
}

export default MisinfoMonitorPage;
