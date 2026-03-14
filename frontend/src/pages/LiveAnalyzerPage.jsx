import React, { useMemo, useState } from 'react';

import ErrorBoundary from '../ErrorBoundary';
import { analyzeText } from '../services/api';

const FALLBACK_ERROR = 'Analysis model is currently loading. Please try again in a moment, or run: `docker exec diaintel-backend python -m app.scripts.download_model` to initialize it.';

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

function LiveAnalyzerPage() {
    const [text, setText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const handleAnalyze = async () => {
        if (!text.trim()) {
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        try {
            const response = await analyzeText(text);
            setResult(response.data);
        } catch (requestError) {
            setResult(null);
            setError(FALLBACK_ERROR);
            console.error(requestError);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const sentimentRows = useMemo(() => {
        if (!result?.sentiment) {
            return [];
        }
        return Object.entries(result.sentiment).map(([drugName, sentiment]) => ({
            drugName,
            ...sentiment,
        }));
    }, [result]);

    return (
        <ErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <div>
                    <h1 className="text-2xl font-bold text-di-text">Real-Time Safety Analyzer</h1>
                    <p className="mt-1 text-sm text-di-text-secondary">
                        Paste any patient forum post, personal medication experience, or clinical note to extract medication safety insights instantly.
                    </p>
                </div>

                <div className="di-card">
                    <textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Example: I've been taking Ozempic 1mg weekly for 3 months. I experienced nausea and vomiting in the first few weeks but my blood sugar has improved significantly."
                        className="di-input min-h-[220px] resize-y font-mono text-sm"
                        rows={8}
                    />
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-di-text-secondary">
                            {text.trim() ? `${text.trim().split(/\s+/).length} words` : 'Enter text to analyze'}
                        </span>
                        <button
                            type="button"
                            onClick={handleAnalyze}
                            disabled={!text.trim() || isAnalyzing}
                            className={`di-btn-primary ${!text.trim() || isAnalyzing ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                        </button>
                    </div>
                </div>

                {error ? (
                    <div className="di-card border border-di-severity-high/40">
                        <h2 className="di-section-title">Analysis Error</h2>
                        <p className="whitespace-pre-wrap text-sm text-di-text-secondary">{error}</p>
                    </div>
                ) : null}

                {result ? (
                    <div className="space-y-6 animate-slide-up">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="di-card text-center">
                                <div className="text-3xl font-bold text-di-accent">{result.drugs?.length || 0}</div>
                                <div className="mt-1 text-sm text-di-text-secondary">Medications Detected</div>
                            </div>
                            <div className="di-card text-center">
                                <div className="text-3xl font-bold text-di-severity-high">{result.adverse_events?.length || 0}</div>
                                <div className="mt-1 text-sm text-di-text-secondary">Side Effects Found</div>
                            </div>
                            <div className="di-card text-center">
                                <div className="text-3xl font-bold text-di-text">
                                    {sentimentRows[0] ? sentimentLabelFromScore(sentimentRows[0].score) : 'Neutral'}
                                </div>
                                <div className="mt-1 text-sm text-di-text-secondary">Patient Sentiment</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                            <div className="di-card xl:col-span-1">
                                <h2 className="di-section-title">Medications</h2>
                                <div className="space-y-3">
                                    {(result.drugs || []).length ? (
                                        result.drugs.map((drug, index) => (
                                            <div key={`${drug.drug_name}-${index}`} className="rounded-xl bg-di-bg/60 p-3 text-sm">
                                                <div className="font-semibold text-di-text">{drug.drug_normalized}</div>
                                                <div className="mt-1 text-di-text-secondary">Detected as: {drug.drug_name}</div>
                                                {drug.dosage ? <div className="mt-1 text-di-text-secondary">Dosage mentioned: {drug.dosage}</div> : null}
                                                <div className="mt-1 text-di-accent">{Math.round(drug.confidence * 100)}% AI confidence</div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-di-border p-6 text-center text-sm text-di-text-secondary">
                                            No medications detected.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="di-card xl:col-span-1">
                                <h2 className="di-section-title">Side Effects</h2>
                                <div className="space-y-3">
                                    {(result.adverse_events || []).length ? (
                                        result.adverse_events.map((event, index) => (
                                            <div key={`${event.ae_term}-${index}`} className="rounded-xl bg-di-bg/60 p-3 text-sm">
                                                <div className="font-semibold text-di-text">{event.ae_term}</div>
                                                <div className="mt-1 text-di-text-secondary">Standardized term: {event.ae_normalized || event.ae_term}</div>
                                                <div className="mt-1 capitalize text-di-text-secondary">Severity level: {event.severity}</div>
                                                <div className="mt-1 text-di-severity-high">{Math.round(event.confidence * 100)}% AI confidence</div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-di-border p-6 text-center text-sm text-di-text-secondary">
                                            No side effects found.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="di-card xl:col-span-1">
                                <h2 className="di-section-title">Patient Sentiment</h2>
                                <div className="space-y-3">
                                    {sentimentRows.length ? (
                                        sentimentRows.map((row) => (
                                            <div key={row.drugName} className="rounded-xl bg-di-bg/60 p-3 text-sm">
                                                <div className="font-semibold capitalize text-di-text">{row.drugName}</div>
                                                <div className="mt-1 text-di-text-secondary">{sentimentLabelFromScore(row.score)}</div>
                                                <div className="mt-1 text-di-accent">{Math.round(row.confidence * 100)}% AI confidence</div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-di-border p-6 text-center text-sm text-di-text-secondary">
                                            No patient sentiment data returned.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="di-card bg-di-accent/5 border-di-accent/20">
                    <h2 className="di-section-title">How it works</h2>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-di-text-secondary">
                        <li>Uses AI to detect medication names, dosages, and side effects from natural language.</li>
                        <li>Extracts structured safety information including severity levels and confidence scores.</li>
                        <li>Provides traceable source confidence for every detected result.</li>
                    </ul>
                </div>
            </div>
        </ErrorBoundary>
    );
}

export default LiveAnalyzerPage;

