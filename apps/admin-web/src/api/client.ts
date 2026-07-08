import axios from 'axios';
import { useAuthStore } from '../store/auth';

// In dev, falls back to '/api/v1' which Vite proxies to localhost:3000.
// In production builds, set VITE_API_BASE_URL=https://api.smartfleetpk.com/api/v1
const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      useAuthStore.getState().clear();
    }
    return Promise.reject(err);
  },
);
