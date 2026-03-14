/**
 * DiaIntel - API Service Layer
 * Centralized API client for all backend endpoints.
 */

import axios from 'axios';

const API_BASE = '/api/v1';

const api = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const message = error.response?.data?.detail || error.message || 'Unknown error';
        console.error(`API Error: ${message}`);
        return Promise.reject(error);
    }
);

// ============================================================
// Dashboard
// ============================================================
export const getDashboardStats = () => api.get('/dashboard/stats');
export const getTrending = () => api.get('/trending');

// ============================================================
// Drug
// ============================================================
export const getDrugInsights = (drugName) => api.get(`/drug/${drugName}/insights`);
export const getDrugTimeline = (drugName) => api.get(`/drug/${drugName}/timeline`);
export const getDrugOutcomes = (drugName) => api.get(`/drug/${drugName}/outcomes`);
export const getDrugTimelineInsights = (drugName) => api.get(`/drug/${drugName}/timeline-insights`);

// ============================================================
// Compare
// ============================================================
export const compareDrugs = (drugs) => api.get('/compare', { params: { drugs: drugs.join(',') } });

// ============================================================
// Graph
// ============================================================
export const getDrugAEGraph = () => api.get('/graph/drug-ae');

// ============================================================
// Combinations
// ============================================================
export const getCombinations = (params = {}) => api.get('/combinations', { params });
export const getDrugCombinations = (drugName) => api.get(`/combinations/${drugName}`);

// ============================================================
// Analyze
// ============================================================
export const analyzeText = (text) => api.post('/analyze', { text });

// ============================================================
// Misinformation
// ============================================================
export const getMisinfoFeed = (params = {}) => api.get('/misinfo/feed', { params });
export const markAsReviewed = (flagId) => api.patch(`/misinfo/${flagId}/review`);

// ============================================================
// AE Trace
// ============================================================
export const getAETrace = (aeId) => api.get(`/ae/trace/${aeId}`);

// ============================================================
// Ingestion
// ============================================================
export const getIngestionStatus = () => api.get('/ingestion/status');

export default api;
