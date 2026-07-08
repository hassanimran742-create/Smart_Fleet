import { api } from './client';

export async function uploadFile(file: File): Promise<{ url: string; key: string }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
